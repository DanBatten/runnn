/**
 * Database Migration Runner
 *
 * Handles schema migrations with version tracking.
 */

import { getDb, execute, queryOne, query } from './client.js';
import { readFileSync, readdirSync } from 'fs';
import { join } from 'path';
import { createHash } from 'crypto';

export interface SchemaVersion {
  version: string;
  applied_at: string;
  description: string | null;
  migration_hash: string | null;
}

/**
 * Get current schema version
 */
export function getCurrentVersion(): string | null {
  try {
    const result = queryOne<SchemaVersion>(
      'SELECT version FROM schema_versions ORDER BY applied_at DESC LIMIT 1'
    );
    return result?.version ?? null;
  } catch {
    // Table doesn't exist yet
    return null;
  }
}

/**
 * Get all applied migrations
 */
export function getAppliedMigrations(): SchemaVersion[] {
  try {
    return query<SchemaVersion>(
      'SELECT * FROM schema_versions ORDER BY applied_at ASC'
    );
  } catch {
    return [];
  }
}

/**
 * Hash a migration file for change detection
 */
function hashMigration(content: string): string {
  return createHash('sha256').update(content).digest('hex').slice(0, 16);
}

/**
 * Apply a migration
 */
export function applyMigration(
  version: string,
  sql: string,
  description?: string
): void {
  const db = getDb();
  const hash = hashMigration(sql);

  // Check if already applied
  const existing = queryOne<SchemaVersion>(
    'SELECT * FROM schema_versions WHERE version = ?',
    [version]
  );

  if (existing) {
    if (existing.migration_hash !== hash) {
      throw new Error(
        `Migration ${version} was already applied with different content. ` +
        `Expected hash: ${existing.migration_hash}, got: ${hash}`
      );
    }
    console.log(`Migration ${version} already applied, skipping`);
    return;
  }

  // Apply migration
  console.log(`Applying migration ${version}...`);
  db.exec(sql);

  // Record migration
  execute(
    `INSERT INTO schema_versions (version, description, migration_hash) VALUES (?, ?, ?)`,
    [version, description ?? null, hash]
  );

  console.log(`Migration ${version} applied successfully`);
}

/**
 * Run all pending migrations from a directory
 */
export function runMigrations(migrationsDir?: string): void {
  const dir = migrationsDir ?? join(import.meta.dirname, '../../migrations');

  // Get migration files
  let files: string[];
  try {
    files = readdirSync(dir)
      .filter(f => f.endsWith('.sql'))
      .sort();
  } catch {
    console.log('No migrations directory found');
    return;
  }

  if (files.length === 0) {
    console.log('No migrations found');
    return;
  }

  const applied = new Set(getAppliedMigrations().map(m => m.version));

  for (const file of files) {
    // Extract version from filename (e.g., "001_initial.sql" -> "001")
    const version = file.split('_')[0];

    if (applied.has(version)) {
      continue;
    }

    const sql = readFileSync(join(dir, file), 'utf-8');
    const description = file.replace(/^\d+_/, '').replace('.sql', '');

    applyMigration(version, sql, description);
  }
}

/**
 * Verify schema integrity
 */
export function verifySchema(): { valid: boolean; issues: string[] } {
  const issues: string[] = [];
  const db = getDb();

  // Check required tables exist
  const requiredTables = [
    'schema_versions',
    'events',
    'raw_ingest',
    'sync_state',
    'settings',
    'workouts',
    'health_snapshots',
    'planned_workouts',
    'training_plans',
    'athlete_knowledge',
    'discovered_patterns',
    'coaching_decisions',
    'coach_sessions',
    'policies',
    'overrides',
    'data_issues',
  ];

  const existingTables = new Set(
    query<{ name: string }>(
      "SELECT name FROM sqlite_master WHERE type='table'"
    ).map(t => t.name)
  );

  for (const table of requiredTables) {
    if (!existingTables.has(table)) {
      issues.push(`Missing required table: ${table}`);
    }
  }

  // Check WAL mode
  const journalMode = db.pragma('journal_mode', { simple: true });
  if (journalMode !== 'wal') {
    issues.push(`Expected journal_mode=wal, got ${journalMode}`);
  }

  // Check foreign keys enabled
  const foreignKeys = db.pragma('foreign_keys', { simple: true });
  if (foreignKeys !== 1) {
    issues.push('Foreign keys not enabled');
  }

  return {
    valid: issues.length === 0,
    issues,
  };
}
