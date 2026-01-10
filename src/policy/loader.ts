/**
 * Policy Loader - Load and manage policies from database
 */

import { query, queryOne, insertWithEvent, updateWithEvent, getDb } from '../db/client.js';
import { readFileSync, readdirSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { nanoid } from 'nanoid';
import type { Policy, PolicyRules, PolicyTest } from './types.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

interface PolicyRow {
  id: string;
  name: string;
  version: number;
  rules: string;
  summary: string;
  is_active: number;
  created_at: string;
  activated_at: string | null;
}

interface PolicyTestRow {
  id: string;
  policy_id: string;
  name: string;
  fixture: string;
  expected_output: string;
  last_run_at: string | null;
  last_result: string | null;
}

/**
 * Get all active policies
 */
export function getActivePolicies(): Policy[] {
  const rows = query<PolicyRow>(
    'SELECT * FROM policies WHERE is_active = 1 ORDER BY name'
  );

  return rows.map(row => ({
    ...row,
    is_active: row.is_active === 1,
    rules: JSON.parse(row.rules) as PolicyRules,
  }));
}

/**
 * Get a policy by name
 */
export function getPolicyByName(name: string): Policy | null {
  const row = queryOne<PolicyRow>(
    'SELECT * FROM policies WHERE name = ?',
    [name]
  );

  if (!row) return null;

  return {
    ...row,
    is_active: row.is_active === 1,
    rules: JSON.parse(row.rules) as PolicyRules,
  };
}

/**
 * Get a policy by ID
 */
export function getPolicyById(id: string): Policy | null {
  const row = queryOne<PolicyRow>(
    'SELECT * FROM policies WHERE id = ?',
    [id]
  );

  if (!row) return null;

  return {
    ...row,
    is_active: row.is_active === 1,
    rules: JSON.parse(row.rules) as PolicyRules,
  };
}

/**
 * Get all policies (including inactive)
 */
export function getAllPolicies(): Policy[] {
  const rows = query<PolicyRow>(
    'SELECT * FROM policies ORDER BY name, version DESC'
  );

  return rows.map(row => ({
    ...row,
    is_active: row.is_active === 1,
    rules: JSON.parse(row.rules) as PolicyRules,
  }));
}

/**
 * Get policy history (all versions)
 */
export function getPolicyHistory(name: string): Policy[] {
  const rows = query<PolicyRow>(
    'SELECT * FROM policies WHERE name = ? ORDER BY version DESC',
    [name]
  );

  return rows.map(row => ({
    ...row,
    is_active: row.is_active === 1,
    rules: JSON.parse(row.rules) as PolicyRules,
  }));
}

/**
 * Create a new policy
 */
export function createPolicy(
  name: string,
  rules: PolicyRules,
  summary: string,
  activate: boolean = false
): string {
  const id = nanoid();

  // Deactivate any existing active policy with same name
  if (activate) {
    const db = getDb();
    db.prepare('UPDATE policies SET is_active = 0 WHERE name = ?').run(name);
  }

  // Get next version number
  const existing = queryOne<{ max_version: number }>(
    'SELECT MAX(version) as max_version FROM policies WHERE name = ?',
    [name]
  );
  const version = (existing?.max_version ?? 0) + 1;

  insertWithEvent(
    'policies',
    {
      id,
      name,
      version,
      rules: JSON.stringify(rules),
      summary,
      is_active: activate ? 1 : 0,
      activated_at: activate ? new Date().toISOString() : null,
    },
    { source: 'policy_loader' }
  );

  return id;
}

/**
 * Activate a policy version
 */
export function activatePolicy(id: string): boolean {
  const policy = getPolicyById(id);
  if (!policy) return false;

  const db = getDb();

  // Deactivate other versions
  db.prepare('UPDATE policies SET is_active = 0 WHERE name = ?').run(policy.name);

  // Activate this version
  updateWithEvent(
    'policies',
    id,
    {
      is_active: 1,
      activated_at: new Date().toISOString(),
    },
    { source: 'policy_loader', reason: 'Policy activated' }
  );

  return true;
}

/**
 * Deactivate a policy
 */
export function deactivatePolicy(id: string): boolean {
  return updateWithEvent(
    'policies',
    id,
    { is_active: 0 },
    { source: 'policy_loader', reason: 'Policy deactivated' }
  );
}

/**
 * Get tests for a policy
 */
export function getPolicyTests(policyId: string): PolicyTest[] {
  const rows = query<PolicyTestRow>(
    'SELECT * FROM policy_tests WHERE policy_id = ? ORDER BY name',
    [policyId]
  );

  return rows.map(row => {
    const expected = JSON.parse(row.expected_output);
    return {
      id: row.id,
      policy_id: row.policy_id,
      name: row.name,
      fixture: JSON.parse(row.fixture),
      expected_triggered: expected.triggered ?? true,
      expected_actions: expected.actions ?? [],
      last_run_at: row.last_run_at ?? undefined,
      last_result: row.last_result as 'pass' | 'fail' | undefined,
    };
  });
}

/**
 * Create a policy test
 */
export function createPolicyTest(
  policyId: string,
  name: string,
  fixture: Record<string, unknown>,
  expectedTriggered: boolean,
  expectedActions: string[] = []
): string {
  const id = nanoid();

  insertWithEvent(
    'policy_tests',
    {
      id,
      policy_id: policyId,
      name,
      fixture: JSON.stringify(fixture),
      expected_output: JSON.stringify({
        triggered: expectedTriggered,
        actions: expectedActions,
      }),
    },
    { source: 'policy_loader' }
  );

  return id;
}

/**
 * Update test result
 */
export function updateTestResult(testId: string, result: 'pass' | 'fail'): void {
  const db = getDb();
  db.prepare(`
    UPDATE policy_tests
    SET last_run_at = datetime('now'), last_result = ?
    WHERE id = ?
  `).run(result, testId);
}

/**
 * Load default policies from JSON files
 */
export function loadDefaultPolicies(): number {
  const defaultsDir = join(__dirname, 'defaults');

  if (!existsSync(defaultsDir)) {
    return 0;
  }

  const files = readdirSync(defaultsDir).filter(f => f.endsWith('.json'));
  let loaded = 0;

  for (const file of files) {
    const filePath = join(defaultsDir, file);
    const content = readFileSync(filePath, 'utf-8');

    try {
      const policy = JSON.parse(content) as {
        name: string;
        summary: string;
        rules: PolicyRules;
        tests?: Array<{
          name: string;
          fixture: Record<string, unknown>;
          expected_triggered: boolean;
          expected_actions?: string[];
        }>;
      };

      // Check if policy already exists
      const existing = getPolicyByName(policy.name);
      if (existing) {
        continue; // Don't overwrite existing policies
      }

      // Create the policy
      const policyId = createPolicy(
        policy.name,
        policy.rules,
        policy.summary,
        true // Activate by default
      );

      // Create tests if provided
      if (policy.tests) {
        for (const test of policy.tests) {
          createPolicyTest(
            policyId,
            test.name,
            test.fixture,
            test.expected_triggered,
            test.expected_actions
          );
        }
      }

      loaded++;
    } catch (error) {
      console.error(`Error loading policy from ${file}:`, error);
    }
  }

  return loaded;
}

/**
 * Export a policy to JSON format
 */
export function exportPolicy(id: string): string | null {
  const policy = getPolicyById(id);
  if (!policy) return null;

  const tests = getPolicyTests(id);

  return JSON.stringify(
    {
      name: policy.name,
      summary: policy.summary,
      rules: policy.rules,
      tests: tests.map(t => ({
        name: t.name,
        fixture: t.fixture,
        expected_triggered: t.expected_triggered,
        expected_actions: t.expected_actions,
      })),
    },
    null,
    2
  );
}
