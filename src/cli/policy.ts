/**
 * Policy command - Manage coaching policies
 */

import chalk from 'chalk';
import { isDbInitialized, closeDb, query, queryOne } from '../db/client.js';
import {
  getActivePolicies,
  loadDefaultPolicies,
  activatePolicy,
  deactivatePolicy,
} from '../policy/loader.js';
import {
  runPolicyTests,
  runAllPolicyTests,
  validatePolicyChange,
  generateTestReport,
} from '../policy/tester.js';

interface PolicyRow {
  id: string;
  name: string;
  version: number;
  rules: string;
  summary: string;
  is_active: number;
  activated_at: string | null;
}

export async function policyCommand(
  subcommand: string,
  name?: string,
  _options?: { toVersion?: string }
): Promise<void> {
  const dbPath = process.env.DATABASE_PATH ?? './data/coach.db';

  if (!isDbInitialized(dbPath)) {
    console.log(chalk.yellow('Database not initialized'));
    console.log(`Run ${chalk.cyan('runnn init')} to create the database`);
    return;
  }

  switch (subcommand) {
    case 'list':
      await listPolicies();
      break;
    case 'show':
      if (!name) {
        console.error(chalk.red('Usage: runnn policy show <name>'));
        break;
      }
      await showPolicy(name);
      break;
    case 'load-defaults':
      await loadDefaults();
      break;
    case 'validate':
      if (name) {
        await validatePolicy(name);
      } else {
        await validateAllPolicies();
      }
      break;
    case 'test':
      if (name) {
        await testPolicy(name);
      } else {
        await testAllPolicies();
      }
      break;
    case 'activate':
      if (!name) {
        console.error(chalk.red('Usage: runnn policy activate <name>'));
        break;
      }
      await activate(name);
      break;
    case 'deactivate':
      if (!name) {
        console.error(chalk.red('Usage: runnn policy deactivate <name>'));
        break;
      }
      await deactivate(name);
      break;
    case 'propose':
      console.log(chalk.yellow('Policy propose not yet implemented'));
      console.log('Will allow proposing policy changes via interactive prompts');
      break;
    case 'apply':
      console.log(chalk.yellow('Policy apply not yet implemented'));
      console.log('Will apply proposed policy changes after validation');
      break;
    default:
      console.error(chalk.red(`Unknown subcommand: ${subcommand}`));
      console.log('Available: list, show, load-defaults, validate, test, activate, deactivate');
  }

  closeDb();
}

async function listPolicies(): Promise<void> {
  console.log(chalk.bold('Coaching Policies'));
  console.log('');

  const policies = query<PolicyRow>(
    'SELECT * FROM policies ORDER BY name'
  );

  if (policies.length === 0) {
    console.log(chalk.yellow('No policies defined'));
    console.log(`Run ${chalk.cyan('runnn policy load-defaults')} to load default policies`);
    return;
  }

  const active = policies.filter(p => p.is_active);
  const inactive = policies.filter(p => !p.is_active);

  if (active.length > 0) {
    console.log(chalk.green.bold('Active Policies:'));
    for (const policy of active) {
      console.log(`  ${chalk.bold(policy.name)} v${policy.version}`);
      console.log(`    ${policy.summary}`);
    }
    console.log('');
  }

  if (inactive.length > 0) {
    console.log(chalk.gray.bold('Inactive Policies:'));
    for (const policy of inactive) {
      console.log(`  ${chalk.gray(policy.name)} v${policy.version}`);
      console.log(`    ${chalk.gray(policy.summary)}`);
    }
    console.log('');
  }

  console.log(`Total: ${policies.length} policies (${active.length} active)`);
}

async function showPolicy(name: string): Promise<void> {
  const policy = queryOne<PolicyRow>(
    'SELECT * FROM policies WHERE name = ?',
    [name]
  );

  if (!policy) {
    console.error(chalk.red(`Policy not found: ${name}`));
    return;
  }

  console.log(chalk.bold(policy.name));
  console.log(`ID: ${policy.id}`);
  console.log(`Version: ${policy.version}`);
  console.log(`Status: ${policy.is_active ? chalk.green('Active') : chalk.gray('Inactive')}`);
  console.log(`Summary: ${policy.summary}`);
  console.log('');
  console.log(chalk.bold('Rules:'));
  try {
    const rules = JSON.parse(policy.rules);
    console.log(JSON.stringify(rules, null, 2));
  } catch {
    console.log(policy.rules);
  }

  // Show test count
  const tests = query<{ count: number }>(
    'SELECT COUNT(*) as count FROM policy_tests WHERE policy_id = ?',
    [policy.id]
  );
  if (tests[0]?.count > 0) {
    console.log('');
    console.log(`Tests: ${tests[0].count} defined`);
  }
}

async function loadDefaults(): Promise<void> {
  console.log(chalk.bold('Loading default policies...'));
  console.log('');

  try {
    const count = loadDefaultPolicies();
    console.log(chalk.green(`✓ Loaded ${count} default policies`));
    console.log('');

    // List what was loaded
    const policies = getActivePolicies();
    for (const policy of policies) {
      console.log(`  ${chalk.cyan(policy.name)}: ${policy.summary}`);
    }
  } catch (error) {
    console.error(chalk.red('Failed to load default policies:'));
    console.error(error instanceof Error ? error.message : String(error));
  }
}

async function validatePolicy(name: string): Promise<void> {
  console.log(chalk.bold(`Validating policy: ${name}`));
  console.log('');

  const policy = queryOne<PolicyRow>(
    'SELECT * FROM policies WHERE name = ?',
    [name]
  );

  if (!policy) {
    console.error(chalk.red(`Policy not found: ${name}`));
    return;
  }

  try {
    const result = validatePolicyChange(policy.id);

    if (result.valid) {
      console.log(chalk.green(`✓ ${result.message}`));
    } else {
      console.log(chalk.red(`✗ Validation failed`));
      console.log(result.message);
    }
  } catch (error) {
    console.error(chalk.red('Validation error:'));
    console.error(error instanceof Error ? error.message : String(error));
  }
}

async function validateAllPolicies(): Promise<void> {
  console.log(chalk.bold('Validating all active policies...'));
  console.log('');

  const policies = getActivePolicies();

  if (policies.length === 0) {
    console.log(chalk.yellow('No active policies to validate'));
    return;
  }

  let allValid = true;
  for (const policy of policies) {
    const result = validatePolicyChange(policy.id);
    if (result.valid) {
      console.log(chalk.green(`✓ ${policy.name}: ${result.message}`));
    } else {
      console.log(chalk.red(`✗ ${policy.name}: Validation failed`));
      allValid = false;
    }
  }

  console.log('');
  if (allValid) {
    console.log(chalk.green('All policies valid'));
  } else {
    console.log(chalk.red('Some policies have failing tests'));
  }
}

async function testPolicy(name: string): Promise<void> {
  console.log(chalk.bold(`Running tests for policy: ${name}`));
  console.log('');

  const policy = queryOne<PolicyRow>(
    'SELECT * FROM policies WHERE name = ?',
    [name]
  );

  if (!policy) {
    console.error(chalk.red(`Policy not found: ${name}`));
    return;
  }

  try {
    const results = runPolicyTests(policy.id);

    console.log(`${results.policy_name}: ${results.passed}/${results.total} tests passed`);
    console.log('');

    for (const result of results.results) {
      const test = queryOne<{ name: string }>(
        'SELECT name FROM policy_tests WHERE id = ?',
        [result.test_id]
      );
      const testName = test?.name ?? result.test_id;

      if (result.passed) {
        console.log(chalk.green(`  ✓ ${testName}`));
      } else {
        console.log(chalk.red(`  ✗ ${testName}`));
        if (result.error) {
          console.log(chalk.gray(`    Error: ${result.error}`));
        } else if (result.expected_triggered !== result.actual_triggered) {
          console.log(chalk.gray(`    Expected triggered=${result.expected_triggered}, got ${result.actual_triggered}`));
        } else {
          console.log(chalk.gray(`    Expected actions [${result.expected_actions.join(', ')}]`));
          console.log(chalk.gray(`    Got actions [${result.actual_actions.join(', ')}]`));
        }
      }
    }
  } catch (error) {
    console.error(chalk.red('Test error:'));
    console.error(error instanceof Error ? error.message : String(error));
  }
}

async function testAllPolicies(): Promise<void> {
  console.log(chalk.bold('Running all policy tests...'));
  console.log('');

  try {
    const results = runAllPolicyTests();
    const report = generateTestReport(results);
    console.log(report);
  } catch (error) {
    console.error(chalk.red('Test error:'));
    console.error(error instanceof Error ? error.message : String(error));
  }
}

async function activate(name: string): Promise<void> {
  const policy = queryOne<PolicyRow>(
    'SELECT * FROM policies WHERE name = ?',
    [name]
  );

  if (!policy) {
    console.error(chalk.red(`Policy not found: ${name}`));
    return;
  }

  if (policy.is_active) {
    console.log(chalk.yellow(`Policy ${name} is already active`));
    return;
  }

  // Validate before activating
  const validation = validatePolicyChange(policy.id);
  if (!validation.valid) {
    console.error(chalk.red(`Cannot activate - validation failed:`));
    console.error(validation.message);
    return;
  }

  activatePolicy(policy.id);
  console.log(chalk.green(`✓ Activated policy: ${name}`));
}

async function deactivate(name: string): Promise<void> {
  const policy = queryOne<PolicyRow>(
    'SELECT * FROM policies WHERE name = ?',
    [name]
  );

  if (!policy) {
    console.error(chalk.red(`Policy not found: ${name}`));
    return;
  }

  if (!policy.is_active) {
    console.log(chalk.yellow(`Policy ${name} is already inactive`));
    return;
  }

  deactivatePolicy(policy.id);
  console.log(chalk.green(`✓ Deactivated policy: ${name}`));
}
