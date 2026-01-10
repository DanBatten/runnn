#!/usr/bin/env tsx
/**
 * Initialize the RunV2 database
 *
 * Usage: npm run db:init
 */

import { existsSync, mkdirSync } from 'fs';
import { dirname } from 'path';
import { initializeDb, isDbInitialized, getDbInfo, closeDb } from '../src/db/client.js';
import { verifySchema } from '../src/db/migrate.js';

const dbPath = process.env.DATABASE_PATH ?? './data/coach.db';

console.log('RunV2 Database Initialization');
console.log('=============================');
console.log(`Database path: ${dbPath}`);
console.log('');

// Check if already initialized
if (isDbInitialized(dbPath)) {
  console.log('Database already exists.');

  const info = getDbInfo();
  console.log(`  Schema version: ${info.schemaVersion}`);
  console.log(`  Journal mode: ${info.journalMode}`);
  console.log(`  Tables: ${info.tableCount}`);

  const { valid, issues } = verifySchema();
  if (valid) {
    console.log('  Schema: Valid');
  } else {
    console.log('  Schema: INVALID');
    issues.forEach(i => console.log(`    - ${i}`));
  }

  closeDb();
  process.exit(0);
}

// Create data directory if needed
const dataDir = dirname(dbPath);
if (!existsSync(dataDir)) {
  console.log(`Creating directory: ${dataDir}`);
  mkdirSync(dataDir, { recursive: true });
}

// Initialize database
console.log('Creating database...');
try {
  initializeDb(dbPath);

  const info = getDbInfo();
  console.log('');
  console.log('Database created successfully!');
  console.log(`  Schema version: ${info.schemaVersion}`);
  console.log(`  Journal mode: ${info.journalMode}`);
  console.log(`  Tables: ${info.tableCount}`);

  const { valid, issues } = verifySchema();
  if (valid) {
    console.log('  Schema: Valid');
  } else {
    console.log('  Schema: INVALID');
    issues.forEach(i => console.log(`    - ${i}`));
    process.exit(1);
  }

  closeDb();
  console.log('');
  console.log('Next steps:');
  console.log('  1. Copy .env.example to .env and add your credentials');
  console.log('  2. Run `runv2 sync` to sync your Garmin data');
  console.log('  3. Run `runv2 morning` for your daily readiness check');
} catch (error) {
  console.error('Failed to initialize database:', error);
  process.exit(1);
}
