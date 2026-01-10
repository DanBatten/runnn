/**
 * Event Sourcing - Append-only mutation ledger
 *
 * Every mutation to domain tables is logged here.
 * This enables:
 * - Full audit trail
 * - Rollback to any point
 * - Debugging unexpected behavior
 *
 * Never delete or modify events. They are the permanent record.
 */

import Database from 'better-sqlite3';
import { nanoid } from 'nanoid';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);

export type EventAction = 'create' | 'update' | 'delete' | 'rollback_applied';

export interface Event {
  id: string;
  timestamp_utc: string;
  entity_type: string;
  entity_id: string;
  action: EventAction;
  before_hash?: string;
  after_hash?: string;
  diff_json?: string;
  source: string;
  reason?: string;
}

export interface EmitEventParams {
  entityType: string;
  entityId: string;
  action: EventAction;
  beforeHash?: string;
  afterHash?: string;
  diffJson?: string;
  source: string;
  reason?: string;
}

// Reference to database (set by client.ts)
export let eventDbRef: Database.Database | null = null;

/**
 * Set the database reference for event emission
 * Called internally by client.ts
 */
export function setEventDb(database: Database.Database): void {
  eventDbRef = database;
}

/**
 * Get database for events - uses cached ref or imports from client
 */
function getEventDatabase(): Database.Database {
  if (eventDbRef) return eventDbRef;

  // Use require to avoid circular dependency at module load time
  const { getDb } = require('./client.js');
  return getDb();
}

/**
 * Emit an event to the append-only ledger
 */
export function emitEvent(params: EmitEventParams): string {
  const database = getEventDatabase();

  const id = `evt_${nanoid(12)}`;

  const stmt = database.prepare(`
    INSERT INTO events (id, entity_type, entity_id, action, before_hash, after_hash, diff_json, source, reason)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  stmt.run(
    id,
    params.entityType,
    params.entityId,
    params.action,
    params.beforeHash ?? null,
    params.afterHash ?? null,
    params.diffJson ?? null,
    params.source,
    params.reason ?? null
  );

  return id;
}

/**
 * Get events for an entity
 */
export function getEntityEvents(
  entityType: string,
  entityId: string,
  options?: { limit?: number }
): Event[] {
  const database = getEventDatabase();

  const limit = options?.limit ?? 100;

  const stmt = database.prepare(`
    SELECT *
    FROM events
    WHERE entity_type = ? AND entity_id = ?
    ORDER BY timestamp_utc DESC
    LIMIT ?
  `);

  return stmt.all(entityType, entityId, limit) as Event[];
}

/**
 * Get recent events across all entities
 */
export function getRecentEvents(options?: {
  limit?: number;
  entityType?: string;
  action?: EventAction;
}): Event[] {
  const database = getEventDatabase();

  const limit = options?.limit ?? 50;
  const conditions: string[] = [];
  const params: unknown[] = [];

  if (options?.entityType) {
    conditions.push('entity_type = ?');
    params.push(options.entityType);
  }

  if (options?.action) {
    conditions.push('action = ?');
    params.push(options.action);
  }

  const whereClause = conditions.length > 0
    ? `WHERE ${conditions.join(' AND ')}`
    : '';

  const stmt = database.prepare(`
    SELECT *
    FROM events
    ${whereClause}
    ORDER BY timestamp_utc DESC
    LIMIT ?
  `);

  params.push(limit);
  return stmt.all(...params) as Event[];
}

/**
 * Get event by ID
 */
export function getEventById(id: string): Event | undefined {
  const database = getEventDatabase();

  const stmt = database.prepare('SELECT * FROM events WHERE id = ?');
  return stmt.get(id) as Event | undefined;
}

/**
 * Get events since a specific event ID
 * Useful for determining what changed since a rollback point
 */
export function getEventsSince(eventId: string): Event[] {
  const database = getEventDatabase();

  // Get the timestamp of the reference event
  const refEvent = getEventById(eventId);
  if (!refEvent) return [];

  const stmt = database.prepare(`
    SELECT *
    FROM events
    WHERE timestamp_utc > ?
    ORDER BY timestamp_utc ASC
  `);

  return stmt.all(refEvent.timestamp_utc) as Event[];
}

/**
 * Count events by type (for analytics)
 */
export function countEventsByType(): Record<string, number> {
  const database = getEventDatabase();

  const stmt = database.prepare(`
    SELECT entity_type, COUNT(*) as count
    FROM events
    GROUP BY entity_type
    ORDER BY count DESC
  `);

  const rows = stmt.all() as Array<{ entity_type: string; count: number }>;
  return Object.fromEntries(rows.map(r => [r.entity_type, r.count]));
}

/**
 * Get total event count
 */
export function getTotalEventCount(): number {
  const database = getEventDatabase();

  const stmt = database.prepare('SELECT COUNT(*) FROM events');
  return stmt.pluck().get() as number;
}
