#!/usr/bin/env node
/**
 * Runnn CLI - Deterministic tooling for the intelligent run coach
 *
 * Golden path commands:
 * - runnn morning    : Morning readiness check
 * - runnn postrun    : Process run and notes
 * - runnn plan week  : Weekly planning
 * - runnn debug why  : Explain a recommendation
 *
 * Core commands:
 * - runnn sync       : Sync Garmin + notes
 * - runnn doctor     : Data quality checks
 * - runnn policy     : Manage coaching policies
 * - runnn export     : Backup and export
 */

import { Command } from 'commander';
import chalk from 'chalk';
import { config } from 'dotenv';

// Load environment variables
config();

const program = new Command();

program
  .name('runnn')
  .description('Intelligent run coach CLI')
  .version('0.1.0');

// ===========================================
// Golden Path Commands
// ===========================================

program
  .command('morning')
  .description('Morning readiness check - shows today\'s workout and readiness factors')
  .action(async () => {
    const { morningCommand } = await import('./morning.js');
    await morningCommand();
  });

program
  .command('postrun')
  .description('Process latest run and pending notes')
  .action(async () => {
    const { postrunCommand } = await import('./postrun.js');
    await postrunCommand();
  });

program
  .command('plan')
  .description('Training plan management')
  .argument('<subcommand>', 'create | week | generate-block')
  .option('--weeks <n>', 'Number of weeks for block', parseInt)
  .option('--start <date>', 'Start date (YYYY-MM-DD)')
  .option('--mileage <n>', 'Target weekly mileage', parseInt)
  .option('--race <name>', 'Race name (for create)')
  .option('--date <date>', 'Race date (for create)')
  .option('--goal <time>', 'Goal time (for create)')
  .option('--quick', 'Quick mode - use smart defaults (for create)')
  .action(async (subcommand: string, options: {
    weeks?: number;
    start?: string;
    mileage?: number;
    race?: string;
    date?: string;
    goal?: string;
    quick?: boolean;
  }) => {
    if (subcommand === 'create') {
      const { planCreateCommand } = await import('./plan-create.js');
      await planCreateCommand({
        race: options.race,
        date: options.date,
        goal: options.goal,
        quick: options.quick,
      });
    } else if (subcommand === 'week') {
      const { planWeekCommand } = await import('./plan-week.js');
      await planWeekCommand();
    } else if (subcommand === 'generate-block') {
      const { planBlockCommand } = await import('./plan-block.js');
      await planBlockCommand({
        weeks: options.weeks,
        startDate: options.start,
        targetMileage: options.mileage,
      });
    } else {
      console.error(chalk.red(`Unknown subcommand: ${subcommand}`));
      process.exit(1);
    }
  });

program
  .command('debug')
  .description('Debug and explain recommendations')
  .argument('<subcommand>', 'why <decision_id>')
  .argument('[id]', 'Decision ID for "why" command')
  .action(async (subcommand: string, id?: string) => {
    if (subcommand === 'why') {
      if (!id) {
        console.error(chalk.red('Usage: runnn debug why <decision_id>'));
        process.exit(1);
      }
      const { debugWhyCommand } = await import('./debug.js');
      await debugWhyCommand(id);
    } else {
      console.error(chalk.red(`Unknown subcommand: ${subcommand}`));
      process.exit(1);
    }
  });

// ===========================================
// Core Commands
// ===========================================

program
  .command('sync')
  .description('Sync Garmin data and process run notes')
  .option('--garmin', 'Sync Garmin data only')
  .option('--notes', 'Process run notes only')
  .option('--force', 'Force full sync (ignore cursor)')
  .option('-v, --verbose', 'Verbose output')
  .action(async (options) => {
    const { syncCommand } = await import('./sync.js');
    await syncCommand(options);
  });

program
  .command('doctor')
  .description('Check data quality and detect anomalies')
  .option('--fix', 'Attempt to auto-fix safe issues')
  .option('--compat', 'Check schema/prompt compatibility')
  .option('-v, --verbose', 'Verbose output')
  .action(async (options) => {
    const { doctorCommand } = await import('./doctor.js');
    await doctorCommand(options);
  });

program
  .command('policy')
  .description('Manage coaching policies')
  .argument('<subcommand>', 'list | show | propose | validate | apply | rollback')
  .argument('[name]', 'Policy name')
  .option('--to-version <version>', 'Version to rollback to')
  .action(async (subcommand: string, name?: string, options?: { toVersion?: string }) => {
    const { policyCommand } = await import('./policy.js');
    await policyCommand(subcommand, name, options);
  });

program
  .command('export')
  .description('Export and backup data')
  .option('--backup', 'Create a database backup')
  .option('--csv', 'Export to CSV files')
  .option('--json', 'Export to JSON files')
  .option('-o, --output <path>', 'Output path')
  .action(async (options) => {
    const { exportCommand } = await import('./export.js');
    await exportCommand(options);
  });

program
  .command('rollback')
  .description('Rollback mutations to a previous state')
  .option('--to <event_id>', 'Event ID to rollback to')
  .option('--last <n>', 'Rollback last N mutations', parseInt)
  .option('--dry-run', 'Show what would be rolled back without applying')
  .action(async (options) => {
    const { rollbackCommand } = await import('./rollback.js');
    await rollbackCommand(options);
  });

// ===========================================
// Utility Commands
// ===========================================

program
  .command('info')
  .description('Show database and system information')
  .action(async () => {
    const { infoCommand } = await import('./info.js');
    await infoCommand();
  });

program
  .command('import-lifeos')
  .description('Import data from LifeOS export')
  .argument('<path>', 'Path to LifeOS JSON export file')
  .option('-v, --verbose', 'Verbose output')
  .action(async (path: string, options) => {
    const { importLifeOSCommand } = await import('../connectors/lifeos-import.js');
    await importLifeOSCommand(path, options);
  });

program
  .command('init')
  .description('Initialize the database')
  .action(async () => {
    const { initializeDb, isDbInitialized, getDbInfo, closeDb } = await import('../db/client.js');
    const { verifySchema } = await import('../db/migrate.js');
    const { existsSync, mkdirSync } = await import('fs');
    const { dirname } = await import('path');

    const dbPath = process.env.DATABASE_PATH ?? './data/coach.db';

    if (isDbInitialized(dbPath)) {
      console.log(chalk.green('Database already initialized'));
      const info = getDbInfo();
      console.log(`  Path: ${info.path}`);
      console.log(`  Version: ${info.schemaVersion}`);
      console.log(`  Tables: ${info.tableCount}`);
      closeDb();
      return;
    }

    // Create directory if needed
    const dataDir = dirname(dbPath);
    if (!existsSync(dataDir)) {
      mkdirSync(dataDir, { recursive: true });
    }

    console.log(chalk.blue('Initializing database...'));
    initializeDb(dbPath);

    const { valid, issues } = verifySchema();
    if (valid) {
      console.log(chalk.green('Database initialized successfully!'));
      const info = getDbInfo();
      console.log(`  Path: ${info.path}`);
      console.log(`  Version: ${info.schemaVersion}`);
      console.log(`  Tables: ${info.tableCount}`);
    } else {
      console.error(chalk.red('Schema verification failed:'));
      issues.forEach(i => console.error(`  - ${i}`));
      process.exit(1);
    }

    closeDb();
  });

// Parse arguments
program.parse();
