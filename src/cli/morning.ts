/**
 * Morning command - Daily readiness check
 *
 * Shows:
 * - Readiness score + factors (HRV delta, sleep, RHR)
 * - Today's planned workout + alternatives if readiness low
 * - Why this workout (links to plan phase + policies)
 * - Active overrides in effect
 * - Any data issues to review
 */

import chalk from 'chalk';
import { isDbInitialized, closeDb } from '../db/client.js';

export async function morningCommand(): Promise<void> {
  const dbPath = process.env.DATABASE_PATH ?? './data/coach.db';

  if (!isDbInitialized(dbPath)) {
    console.log(chalk.yellow('Database not initialized'));
    console.log(`Run ${chalk.cyan('runnn init')} to create the database`);
    return;
  }

  console.log(chalk.bold('Good morning! Let me check your readiness...'));
  console.log('');

  // TODO: Implement full morning readiness check
  // For now, show placeholder

  console.log(chalk.yellow('Morning readiness check not yet fully implemented'));
  console.log('');
  console.log('This command will show:');
  console.log('  - Readiness score based on HRV, sleep, RHR');
  console.log('  - Today\'s planned workout');
  console.log('  - Alternatives if readiness is low');
  console.log('  - Active overrides');
  console.log('  - Data issues to review');

  closeDb();
}
