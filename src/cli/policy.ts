/**
 * Policy command - Manage coaching policies
 */

import chalk from 'chalk';
import { isDbInitialized, closeDb, query, queryOne } from '../db/client.js';

interface Policy {
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
    case 'propose':
      console.log(chalk.yellow('Policy propose not yet implemented'));
      break;
    case 'validate':
      await validatePolicies();
      break;
    case 'apply':
      console.log(chalk.yellow('Policy apply not yet implemented'));
      break;
    case 'rollback':
      console.log(chalk.yellow('Policy rollback not yet implemented'));
      break;
    default:
      console.error(chalk.red(`Unknown subcommand: ${subcommand}`));
      console.log('Available: list, show, propose, validate, apply, rollback');
  }

  closeDb();
}

async function listPolicies(): Promise<void> {
  console.log(chalk.bold('Coaching Policies'));
  console.log('');

  const policies = query<Policy>(
    'SELECT * FROM policies ORDER BY name'
  );

  if (policies.length === 0) {
    console.log(chalk.yellow('No policies defined'));
    console.log('Default policies will be created on first run');
    return;
  }

  for (const policy of policies) {
    const status = policy.is_active ? chalk.green('active') : chalk.gray('inactive');
    console.log(`${chalk.bold(policy.name)} v${policy.version} [${status}]`);
    console.log(`  ${policy.summary}`);
    console.log('');
  }
}

async function showPolicy(name: string): Promise<void> {
  const policy = queryOne<Policy>(
    'SELECT * FROM policies WHERE name = ?',
    [name]
  );

  if (!policy) {
    console.error(chalk.red(`Policy not found: ${name}`));
    return;
  }

  console.log(chalk.bold(policy.name));
  console.log(`Version: ${policy.version}`);
  console.log(`Status: ${policy.is_active ? 'Active' : 'Inactive'}`);
  console.log(`Summary: ${policy.summary}`);
  console.log('');
  console.log('Rules:');
  try {
    const rules = JSON.parse(policy.rules);
    console.log(JSON.stringify(rules, null, 2));
  } catch {
    console.log(policy.rules);
  }
}

async function validatePolicies(): Promise<void> {
  console.log(chalk.bold('Validating policies...'));
  console.log('');

  // TODO: Run policy tests
  console.log(chalk.yellow('Policy validation not yet implemented'));
  console.log('Will run policy_tests fixtures and verify expected outputs');
}
