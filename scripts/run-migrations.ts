#!/usr/bin/env tsx
/**
 * Run pending database migrations
 */

import { runMigrations } from '../src/db/migrate.js';
import { initializeDb, closeDb } from '../src/db/client.js';

const dbPath = process.env.DATABASE_PATH ?? './data/coach.db';
console.log(`Database: ${dbPath}`);

initializeDb(dbPath);
runMigrations('./migrations');
closeDb();

console.log('Done!');
