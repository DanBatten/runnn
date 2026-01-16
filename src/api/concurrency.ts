/**
 * Concurrency Control - SQLite single-writer discipline
 *
 * Ensures:
 * - Serialized writes through a queue
 * - Proper busy_timeout configuration
 * - Lock records for debugging
 * - Idempotency key management
 */

import { getDb, execute, queryOne } from '../db/client.js';
import type { Lock, IdempotencyRecord } from './types.js';
import { generateId } from './types.js';

// In-memory write queue for serialization
let writeQueue: Promise<void> = Promise.resolve();

// Default idempotency TTL: 24 hours
const IDEMPOTENCY_TTL_MS = 24 * 60 * 60 * 1000;

/**
 * Acquire a write lock for an operation
 * Serializes writes through a queue to prevent SQLite BUSY errors
 */
export async function acquireWriteLock(
  operation: string,
  trace_id: string
): Promise<Lock> {
  const lock: Lock = {
    operation,
    trace_id,
    acquired_at: Date.now(),
  };

  // Chain onto the write queue
  const previousQueue = writeQueue;

  writeQueue = (async () => {
    await previousQueue;

    // Ensure busy_timeout is set
    const db = getDb();
    db.pragma('busy_timeout = 5000');

    // Insert lock record for debugging/monitoring
    try {
      execute(
        `INSERT INTO active_locks (id, operation, trace_id, acquired_at)
         VALUES (?, ?, ?, datetime('now'))`,
        [generateId('lock'), operation, trace_id]
      );
    } catch {
      // active_locks table may not exist yet - that's ok
    }
  })();

  await writeQueue;
  return lock;
}

/**
 * Release a write lock
 */
export async function releaseWriteLock(lock: Lock): Promise<void> {
  try {
    execute(
      `DELETE FROM active_locks WHERE trace_id = ?`,
      [lock.trace_id]
    );
  } catch {
    // Table may not exist - that's ok
  }
}

/**
 * Check if an idempotency key has already been processed
 * Returns the cached result if found
 */
export async function checkIdempotency<T>(key: string): Promise<T | null> {
  try {
    const record = queryOne<IdempotencyRecord>(
      `SELECT * FROM idempotency_keys
       WHERE key = ? AND expires_at > datetime('now')`,
      [key]
    );

    if (record) {
      return JSON.parse(record.result_json) as T;
    }
  } catch {
    // Table may not exist - that's ok, return null
  }

  return null;
}

/**
 * Store an idempotency key with its result
 */
export async function storeIdempotency<T>(
  key: string,
  result: T,
  ttlMs: number = IDEMPOTENCY_TTL_MS
): Promise<void> {
  const expiresAt = new Date(Date.now() + ttlMs).toISOString();

  try {
    execute(
      `INSERT OR REPLACE INTO idempotency_keys (key, result_json, created_at, expires_at)
       VALUES (?, ?, datetime('now'), ?)`,
      [key, JSON.stringify(result), expiresAt]
    );
  } catch {
    // Table may not exist - that's ok, idempotency is best-effort
  }
}

/**
 * Clean up expired idempotency keys
 */
export async function cleanupIdempotencyKeys(): Promise<number> {
  try {
    const result = execute(
      `DELETE FROM idempotency_keys WHERE expires_at < datetime('now')`
    );
    return result.changes;
  } catch {
    return 0;
  }
}

/**
 * Check for stale locks (locks held longer than expected)
 * Returns locks older than the threshold
 */
export function getStaleLocksSync(thresholdMs: number = 60000): Lock[] {
  try {
    const cutoff = new Date(Date.now() - thresholdMs).toISOString();
    const rows = getDb()
      .prepare(
        `SELECT operation, trace_id, acquired_at
         FROM active_locks
         WHERE acquired_at < ?`
      )
      .all(cutoff) as Array<{
        operation: string;
        trace_id: string;
        acquired_at: string;
      }>;

    return rows.map(r => ({
      operation: r.operation,
      trace_id: r.trace_id,
      acquired_at: new Date(r.acquired_at).getTime(),
    }));
  } catch {
    return [];
  }
}

/**
 * Force-clear all active locks (use with caution - for recovery only)
 */
export function clearAllLocks(): number {
  try {
    const result = execute(`DELETE FROM active_locks`);
    return result.changes;
  } catch {
    return 0;
  }
}

/**
 * Run a write operation with lock management and idempotency
 */
export async function withWriteLock<T>(
  operation: string,
  trace_id: string,
  idempotencyKey: string | undefined,
  fn: () => Promise<T>
): Promise<{ result: T; cached: boolean }> {
  // Check idempotency first
  if (idempotencyKey) {
    const cached = await checkIdempotency<T>(idempotencyKey);
    if (cached !== null) {
      return { result: cached, cached: true };
    }
  }

  // Acquire lock
  const lock = await acquireWriteLock(operation, trace_id);

  try {
    const result = await fn();

    // Store idempotency key if provided
    if (idempotencyKey) {
      await storeIdempotency(idempotencyKey, result);
    }

    return { result, cached: false };
  } finally {
    await releaseWriteLock(lock);
  }
}
