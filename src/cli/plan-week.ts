/**
 * Plan Week command - Weekly planning
 */

import chalk from 'chalk';
import { isDbInitialized, closeDb } from '../db/client.js';

export async function planWeekCommand(): Promise<void> {
  const dbPath = process.env.DATABASE_PATH ?? './data/coach.db';

  if (!isDbInitialized(dbPath)) {
    console.log(chalk.yellow('Database not initialized'));
    console.log(`Run ${chalk.cyan('runnn init')} to create the database`);
    return;
  }

  console.log(chalk.bold('Weekly Planning'));
  console.log('');
  console.log(chalk.yellow('Weekly planning not yet implemented'));

  closeDb();
}
