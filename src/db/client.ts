/**
 * SQLite Database Client
 *
 * Features:
 * - WAL mode for crash safety + concurrent reads
 * - Automatic event emission for all mutations
 * - Type-safe query helpers
 */

import Database from 'better-sqlite3';
import { join } from 'path';
import { readFileSync, existsSync } from 'fs';
import { nanoid } from 'nanoid';
import { emitEvent } from './events.js';

export interface DbConfig {
  path: string;
  readonly?: boolean;
}

let db: Database.Database | null = null;

/**
 * Get or create database connection
 */
export function getDb(config?: DbConfig): Database.Database {
  if (db) return db;

  const dbPath = config?.path ?? process.env.DATABASE_PATH ?? './data/coach.db';

  db = new Database(dbPath, {
    readonly: config?.readonly ?? false,
  });

  // Enable WAL mode and sane settings
  db.pragma('journal_mode = WAL');
  db.pragma('busy_timeout = 5000');
  db.pragma('foreign_keys = ON');
  db.pragma('synchronous = NORMAL');

  return db;
}

/**
 * Close database connection
 */
export function closeDb(): void {
  if (db) {
    db.close();
    db = null;
  }
}

/**
 * Initialize database with schema
 */
export function initializeDb(dbPath?: string): Database.Database {
  const database = getDb({ path: dbPath ?? './data/coach.db' });

  // Read and execute schema
  const schemaPath = join(import.meta.dirname, 'schema.sql');
  const schema = readFileSync(schemaPath, 'utf-8');

  // Execute schema (multiple statements)
  database.exec(schema);

  return database;
}

/**
 * Check if database is initialized
 */
export function isDbInitialized(dbPath?: string): boolean {
  const path = dbPath ?? process.env.DATABASE_PATH ?? './data/coach.db';
  if (!existsSync(path)) return false;

  try {
    const database = new Database(path, { readonly: true });
    const result = database
      .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='schema_versions'")
      .get();
    database.close();
    return !!result;
  } catch {
    return false;
  }
}

/**
 * Generate a unique ID
 */
export function generateId(prefix?: string): string {
  const id = nanoid(12);
  return prefix ? `${prefix}_${id}` : id;
}

/**
 * Hash an object for change detection
 */
export function hashObject(obj: unknown): string {
  const str = JSON.stringify(obj, Object.keys(obj as object).sort());
  // Simple hash for change detection (not cryptographic)
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash; // Convert to 32bit integer
  }
  return Math.abs(hash).toString(16).padStart(8, '0');
}

/**
 * Insert a row and emit event
 */
export function insertWithEvent<T extends Record<string, unknown>>(
  tableName: string,
  data: T,
  options: {
    source: string;
    reason?: string;
    entityId?: string;
  }
): string {
  const database = getDb();
  const id = (data.id as string) ?? generateId(tableName);
  const dataWithId = { ...data, id };

  const columns = Object.keys(dataWithId);
  const placeholders = columns.map(() => '?').join(', ');
  const values = columns.map(col => {
    const val = dataWithId[col];
    // Handle null explicitly (typeof null === 'object' in JS)
    if (val === null || val === undefined) return null;
    return typeof val === 'object' ? JSON.stringify(val) : val;
  });

  const stmt = database.prepare(
    `INSERT INTO ${tableName} (${columns.join(', ')}) VALUES (${placeholders})`
  );
  stmt.run(...values);

  // Emit event
  emitEvent({
    entityType: tableName,
    entityId: options.entityId ?? id,
    action: 'create',
    afterHash: hashObject(dataWithId),
    diffJson: JSON.stringify(dataWithId),
    source: options.source,
    reason: options.reason,
  });

  return id;
}

/**
 * Update a row and emit event
 */
export function updateWithEvent<T extends Record<string, unknown>>(
  tableName: string,
  id: string,
  updates: Partial<T>,
  options: {
    source: string;
    reason?: string;
  }
): boolean {
  const database = getDb();

  // Get current state for diff
  const current = database
    .prepare(`SELECT * FROM ${tableName} WHERE id = ?`)
    .get(id) as T | undefined;

  if (!current) return false;

  const beforeHash = hashObject(current);

  // Build update statement
  const setClauses: string[] = [];
  const values: unknown[] = [];

  for (const [key, value] of Object.entries(updates)) {
    setClauses.push(`${key} = ?`);
    values.push(typeof value === 'object' ? JSON.stringify(value) : value);
  }

  // Add updated_at if column exists
  if ('updated_at' in current) {
    setClauses.push('updated_at = datetime("now")');
  }

  values.push(id);

  const stmt = database.prepare(
    `UPDATE ${tableName} SET ${setClauses.join(', ')} WHERE id = ?`
  );
  const result = stmt.run(...values);

  if (result.changes > 0) {
    // Get new state
    const newState = database
      .prepare(`SELECT * FROM ${tableName} WHERE id = ?`)
      .get(id);

    // Emit event
    emitEvent({
      entityType: tableName,
      entityId: id,
      action: 'update',
      beforeHash,
      afterHash: hashObject(newState),
      diffJson: JSON.stringify(updates),
      source: options.source,
      reason: options.reason,
    });
  }

  return result.changes > 0;
}

/**
 * Delete a row and emit event
 */
export function deleteWithEvent(
  tableName: string,
  id: string,
  options: {
    source: string;
    reason?: string;
  }
): boolean {
  const database = getDb();

  // Get current state for event
  const current = database
    .prepare(`SELECT * FROM ${tableName} WHERE id = ?`)
    .get(id);

  if (!current) return false;

  const beforeHash = hashObject(current);

  const stmt = database.prepare(`DELETE FROM ${tableName} WHERE id = ?`);
  const result = stmt.run(id);

  if (result.changes > 0) {
    emitEvent({
      entityType: tableName,
      entityId: id,
      action: 'delete',
      beforeHash,
      diffJson: JSON.stringify(current),
      source: options.source,
      reason: options.reason,
    });
  }

  return result.changes > 0;
}

/**
 * Run a query and return all results
 */
export function query<T>(sql: string, params?: unknown[]): T[] {
  const database = getDb();
  const stmt = database.prepare(sql);
  return (params ? stmt.all(...params) : stmt.all()) as T[];
}

/**
 * Run a query and return first result
 */
export function queryOne<T>(sql: string, params?: unknown[]): T | undefined {
  const database = getDb();
  const stmt = database.prepare(sql);
  return (params ? stmt.get(...params) : stmt.get()) as T | undefined;
}

/**
 * Execute a statement (for non-SELECT queries without event tracking)
 */
export function execute(sql: string, params?: unknown[]): Database.RunResult {
  const database = getDb();
  const stmt = database.prepare(sql);
  return params ? stmt.run(...params) : stmt.run();
}

/**
 * Run multiple statements in a transaction
 */
export function transaction<T>(fn: () => T): T {
  const database = getDb();
  return database.transaction(fn)();
}

/**
 * Get database info
 */
export function getDbInfo(): {
  path: string;
  journalMode: string;
  schemaVersion: string | null;
  tableCount: number;
} {
  const database = getDb();

  const journalMode = database.pragma('journal_mode', { simple: true }) as string;

  const schemaVersion = database
    .prepare('SELECT version FROM schema_versions ORDER BY applied_at DESC LIMIT 1')
    .pluck()
    .get() as string | null;

  const tableCount = database
    .prepare("SELECT COUNT(*) FROM sqlite_master WHERE type='table'")
    .pluck()
    .get() as number;

  return {
    path: database.name,
    journalMode,
    schemaVersion,
    tableCount,
  };
}
