/**
 * Export command - Export and backup data
 */

import chalk from 'chalk';
import { isDbInitialized, closeDb, getDb } from '../db/client.js';
import { existsSync, mkdirSync, copyFileSync } from 'fs';
import { join } from 'path';

interface ExportOptions {
  backup?: boolean;
  csv?: boolean;
  json?: boolean;
  output?: string;
}

export async function exportCommand(options: ExportOptions): Promise<void> {
  const dbPath = process.env.DATABASE_PATH ?? './data/coach.db';

  if (!isDbInitialized(dbPath)) {
    console.log(chalk.yellow('Database not initialized'));
    console.log(`Run ${chalk.cyan('runnn init')} to create the database`);
    return;
  }

  if (options.backup) {
    await createBackup(dbPath, options.output);
  } else if (options.csv) {
    console.log(chalk.yellow('CSV export not yet implemented'));
  } else if (options.json) {
    console.log(chalk.yellow('JSON export not yet implemented'));
  } else {
    // Default to backup
    await createBackup(dbPath, options.output);
  }

  closeDb();
}

async function createBackup(dbPath: string, outputPath?: string): Promise<void> {
  const db = getDb();

  // Checkpoint WAL to ensure all data is in main file
  console.log(chalk.blue('Checkpointing WAL...'));
  db.pragma('wal_checkpoint(TRUNCATE)');

  // Generate backup filename
  const timestamp = new Date().toISOString().slice(0, 10);
  const backupDir = outputPath ?? './data/backups';
  const backupPath = join(backupDir, `coach-${timestamp}.db`);

  // Create backup directory if needed
  if (!existsSync(backupDir)) {
    mkdirSync(backupDir, { recursive: true });
  }

  console.log(chalk.blue(`Creating backup: ${backupPath}`));
  copyFileSync(dbPath, backupPath);

  // Also create/update 'latest' symlink conceptually
  const latestPath = join(backupDir, 'coach-latest.db');
  if (existsSync(latestPath)) {
    const { unlinkSync } = await import('fs');
    unlinkSync(latestPath);
  }
  copyFileSync(dbPath, latestPath);

  console.log(chalk.green('Backup created successfully!'));
  console.log(`  Main: ${backupPath}`);
  console.log(`  Latest: ${latestPath}`);
}
