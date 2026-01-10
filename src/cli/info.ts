/**
 * Info command - Show database and system information
 */

import chalk from 'chalk';
import { getDbInfo, closeDb, isDbInitialized } from '../db/client.js';
import { verifySchema } from '../db/migrate.js';
import { getTotalEventCount, countEventsByType } from '../db/events.js';

export async function infoCommand(): Promise<void> {
  console.log(chalk.bold('Runnn System Information'));
  console.log('========================');
  console.log('');

  const dbPath = process.env.DATABASE_PATH ?? './data/coach.db';

  if (!isDbInitialized(dbPath)) {
    console.log(chalk.yellow('Database not initialized'));
    console.log(`Run ${chalk.cyan('runnn init')} to create the database`);
    return;
  }

  // Database info
  const info = getDbInfo();
  console.log(chalk.bold('Database'));
  console.log(`  Path: ${info.path}`);
  console.log(`  Schema version: ${info.schemaVersion}`);
  console.log(`  Journal mode: ${info.journalMode}`);
  console.log(`  Tables: ${info.tableCount}`);

  // Schema verification
  const { valid, issues } = verifySchema();
  console.log(`  Schema valid: ${valid ? chalk.green('Yes') : chalk.red('No')}`);
  if (!valid) {
    issues.forEach(i => console.log(chalk.red(`    - ${i}`)));
  }

  console.log('');

  // Event stats
  console.log(chalk.bold('Events'));
  const totalEvents = getTotalEventCount();
  console.log(`  Total events: ${totalEvents}`);

  if (totalEvents > 0) {
    const byType = countEventsByType();
    const topTypes = Object.entries(byType).slice(0, 5);
    console.log('  By entity type:');
    topTypes.forEach(([type, count]) => {
      console.log(`    ${type}: ${count}`);
    });
  }

  console.log('');

  // Environment
  console.log(chalk.bold('Environment'));
  console.log(`  Privacy mode: ${process.env.PRIVACY_MODE ?? 'standard'}`);
  console.log(`  Timezone: ${process.env.TIMEZONE ?? 'America/Los_Angeles'}`);
  console.log(`  Garmin configured: ${process.env.GARMIN_EMAIL ? chalk.green('Yes') : chalk.yellow('No')}`);
  console.log(`  OpenAI configured: ${process.env.OPENAI_API_KEY ? chalk.green('Yes') : chalk.yellow('No')}`);

  closeDb();
}
