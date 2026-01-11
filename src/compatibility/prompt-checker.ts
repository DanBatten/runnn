/**
 * Prompt Checker - Verify prompts are compatible with current schema
 *
 * Checks:
 * - Prompt version tracking
 * - Required fields available
 * - Context packs can be built
 */

import { createHash } from 'crypto';
import { readFileSync, existsSync } from 'fs';
import { join } from 'path';
import { query, queryOne, execute } from '../db/client.js';
import { checkSchemaForContract, type SchemaCheckResult } from './schema-checker.js';
import { getAllContracts } from './contracts.js';

export interface PromptVersion {
  id: string;
  name: string;
  version: number;
  hash: string;
  changelog: string | null;
  required_fields: string;
  required_tools: string;
  created_at: string;
}

export interface PromptCompatibilityResult {
  prompt_name: string;
  compatible: boolean;
  schema_check: SchemaCheckResult;
  version_info: {
    current_version: number | null;
    latest_hash: string | null;
    content_changed: boolean;
  };
  issues: string[];
  warnings: string[];
}

const PROMPTS_DIR = join(process.cwd(), 'src', 'prompts');

/**
 * Check compatibility for a single prompt
 */
export function checkPromptCompatibility(
  promptName: string
): PromptCompatibilityResult {
  const contract = getAllContracts().find(c => c.prompt_name === promptName);
  const issues: string[] = [];
  const warnings: string[] = [];

  if (!contract) {
    return {
      prompt_name: promptName,
      compatible: false,
      schema_check: {
        valid: false,
        missing_tables: [],
        missing_columns: [],
        type_mismatches: [],
        nullable_mismatches: [],
      },
      version_info: {
        current_version: null,
        latest_hash: null,
        content_changed: false,
      },
      issues: [`No contract defined for prompt "${promptName}"`],
      warnings: [],
    };
  }

  // Check schema compatibility
  const schemaCheck = checkSchemaForContract(contract);

  if (!schemaCheck.valid) {
    issues.push('Schema does not meet prompt requirements');
  }

  if (schemaCheck.nullable_mismatches.length > 0) {
    warnings.push('Some columns have different nullability than expected');
  }

  // Check prompt file and version
  const promptFile = join(PROMPTS_DIR, `${promptName}.md`);
  let currentHash: string | null = null;
  let contentChanged = false;

  if (existsSync(promptFile)) {
    const content = readFileSync(promptFile, 'utf-8');
    currentHash = hashContent(content);

    // Check if content has changed from stored version
    const storedVersion = getLatestPromptVersion(promptName);
    if (storedVersion && storedVersion.hash !== currentHash) {
      contentChanged = true;
      warnings.push('Prompt file has been modified since last recorded version');
    }
  } else {
    warnings.push(`Prompt file not found: ${promptFile}`);
  }

  // Get version info
  const latestVersion = getLatestPromptVersion(promptName);

  return {
    prompt_name: promptName,
    compatible: schemaCheck.valid,
    schema_check: schemaCheck,
    version_info: {
      current_version: latestVersion?.version ?? null,
      latest_hash: currentHash,
      content_changed: contentChanged,
    },
    issues,
    warnings,
  };
}

/**
 * Check compatibility for all registered prompts
 */
export function checkAllPromptsCompatibility(): Map<string, PromptCompatibilityResult> {
  const results = new Map<string, PromptCompatibilityResult>();
  const contracts = getAllContracts();

  for (const contract of contracts) {
    results.set(contract.prompt_name, checkPromptCompatibility(contract.prompt_name));
  }

  return results;
}

/**
 * Get latest stored version of a prompt
 */
export function getLatestPromptVersion(promptName: string): PromptVersion | null {
  const row = queryOne<{
    id: string;
    name: string;
    version: number;
    hash: string;
    changelog: string | null;
    required_fields: string;
    required_tools: string;
    created_at: string;
  }>(
    `SELECT * FROM prompt_versions
     WHERE name = ?
     ORDER BY version DESC
     LIMIT 1`,
    [promptName]
  );

  return row ?? null;
}

/**
 * Get all versions of a prompt
 */
export function getPromptVersionHistory(promptName: string): PromptVersion[] {
  return query<PromptVersion>(
    `SELECT * FROM prompt_versions
     WHERE name = ?
     ORDER BY version DESC`,
    [promptName]
  );
}

/**
 * Record a new prompt version
 */
export function recordPromptVersion(
  promptName: string,
  changelog?: string
): PromptVersion | null {
  const contract = getAllContracts().find(c => c.prompt_name === promptName);
  if (!contract) return null;

  const promptFile = join(PROMPTS_DIR, `${promptName}.md`);
  if (!existsSync(promptFile)) return null;

  const content = readFileSync(promptFile, 'utf-8');
  const hash = hashContent(content);

  // Check if this exact version already exists
  const existing = queryOne<{ id: string }>(
    `SELECT id FROM prompt_versions WHERE name = ? AND hash = ?`,
    [promptName, hash]
  );

  if (existing) {
    return getLatestPromptVersion(promptName);
  }

  // Get next version number
  const latest = getLatestPromptVersion(promptName);
  const nextVersion = (latest?.version ?? 0) + 1;

  const id = `pv_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

  execute(
    `INSERT INTO prompt_versions
     (id, name, version, hash, changelog, required_fields, required_tools, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      id,
      promptName,
      nextVersion,
      hash,
      changelog ?? null,
      JSON.stringify(contract.required_fields),
      JSON.stringify(contract.required_tools),
      new Date().toISOString(),
    ]
  );

  return getLatestPromptVersion(promptName);
}

/**
 * Generate compatibility report for all prompts
 */
export function generateCompatibilityReport(): string {
  const results = checkAllPromptsCompatibility();
  const lines: string[] = [
    '='.repeat(60),
    'PROMPT COMPATIBILITY REPORT',
    `Generated: ${new Date().toISOString()}`,
    '='.repeat(60),
    '',
  ];

  let allCompatible = true;

  for (const [promptName, result] of results) {
    const status = result.compatible ? '✓ PASS' : '✗ FAIL';
    lines.push(`${status} ${promptName}`);

    if (!result.compatible) {
      allCompatible = false;
    }

    if (result.issues.length > 0) {
      result.issues.forEach(i => lines.push(`    Issue: ${i}`));
    }

    if (result.warnings.length > 0) {
      result.warnings.forEach(w => lines.push(`    Warning: ${w}`));
    }

    if (result.schema_check.missing_tables.length > 0) {
      lines.push(`    Missing tables: ${result.schema_check.missing_tables.join(', ')}`);
    }

    if (result.schema_check.missing_columns.length > 0) {
      const cols = result.schema_check.missing_columns
        .map(c => `${c.table}.${c.column}`)
        .join(', ');
      lines.push(`    Missing columns: ${cols}`);
    }

    if (result.version_info.content_changed) {
      lines.push(`    Note: Prompt content has changed, consider recording new version`);
    }

    lines.push('');
  }

  lines.push('='.repeat(60));
  lines.push(`OVERALL: ${allCompatible ? 'ALL PROMPTS COMPATIBLE' : 'COMPATIBILITY ISSUES DETECTED'}`);
  lines.push('='.repeat(60));

  return lines.join('\n');
}

/**
 * Validate that a schema change won't break prompts
 */
export function validateSchemaChange(
  tableName: string,
  columnName: string,
  changeType: 'drop' | 'rename' | 'type_change'
): {
  safe: boolean;
  affected_prompts: string[];
  details: string;
} {
  const affectedPrompts: string[] = [];
  const contracts = getAllContracts();

  for (const contract of contracts) {
    // Check if table is required
    if (changeType === 'drop' && contract.required_tables.includes(tableName)) {
      affectedPrompts.push(contract.prompt_name);
      continue;
    }

    // Check if column is required
    for (const tableReq of contract.required_fields) {
      if (tableReq.table === tableName) {
        const fieldReq = tableReq.fields.find(f => f.name === columnName);
        if (fieldReq) {
          affectedPrompts.push(contract.prompt_name);
          break;
        }
      }
    }
  }

  const safe = affectedPrompts.length === 0;
  const details = safe
    ? `Change to ${tableName}.${columnName} is safe - no prompts depend on it`
    : `Change would break ${affectedPrompts.length} prompt(s): ${affectedPrompts.join(', ')}`;

  return { safe, affected_prompts: affectedPrompts, details };
}

// Helper functions

function hashContent(content: string): string {
  return createHash('sha256').update(content).digest('hex').slice(0, 16);
}
