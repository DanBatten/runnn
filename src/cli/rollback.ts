/**
 * Rollback command - Revert to a previous state via event sourcing
 */

import chalk from 'chalk';
import { isDbInitialized, closeDb, query, queryOne } from '../db/client.js';

interface Event {
  id: string;
  timestamp_utc: string;
  entity_type: string;
  entity_id: string;
  action: string;
  before_hash: string | null;
  after_hash: string | null;
  diff_json: string | null;
  source: string;
  reason: string | null;
}

interface RollbackOptions {
  to?: string;
  last?: number;
  dryRun?: boolean;
  verbose?: boolean;
}

export async function rollbackCommand(options: RollbackOptions): Promise<void> {
  const dbPath = process.env.DATABASE_PATH ?? './data/coach.db';

  if (!isDbInitialized(dbPath)) {
    console.log(chalk.yellow('Database not initialized'));
    console.log(`Run ${chalk.cyan('runnn init')} to create the database`);
    return;
  }

  // Must specify either --to or --last
  if (!options.to && !options.last) {
    console.log(chalk.bold('Recent Events (for rollback reference)'));
    console.log('');
    await listEventsCommand({ limit: 10 });
    console.log('');
    console.log('Usage:');
    console.log(`  ${chalk.cyan('runnn rollback --to <event_id>')}  Rollback to specific event`);
    console.log(`  ${chalk.cyan('runnn rollback --last <n>')}       Rollback last N mutations`);
    console.log(`  ${chalk.cyan('runnn rollback --dry-run')}        Preview without applying`);
    closeDb();
    return;
  }

  let eventId: string;

  if (options.last) {
    // Find the Nth event from the end
    const events = query<Event>(
      'SELECT id FROM events ORDER BY timestamp_utc DESC LIMIT ?',
      [options.last]
    );
    if (events.length < options.last) {
      console.error(chalk.red(`Only ${events.length} events exist, cannot rollback ${options.last}`));
      closeDb();
      return;
    }
    eventId = events[events.length - 1].id;
    console.log(chalk.blue(`Rolling back last ${options.last} event(s)`));
  } else {
    eventId = options.to!;
  }

  console.log(chalk.bold(`Rollback to event: ${eventId}`));
  console.log('');

  // Find the target event
  const targetEvent = queryOne<Event>(
    'SELECT * FROM events WHERE id = ?',
    [eventId]
  );

  if (!targetEvent) {
    console.error(chalk.red(`Event not found: ${eventId}`));
    closeDb();
    return;
  }

  console.log(chalk.blue('Target event:'));
  console.log(`  ID: ${targetEvent.id}`);
  console.log(`  Time: ${targetEvent.timestamp_utc}`);
  console.log(`  Entity: ${targetEvent.entity_type}/${targetEvent.entity_id}`);
  console.log(`  Action: ${targetEvent.action}`);
  console.log('');

  // Find all events after this one
  const eventsToRevert = query<Event>(
    `SELECT * FROM events
     WHERE timestamp_utc > ?
     ORDER BY timestamp_utc DESC`,
    [targetEvent.timestamp_utc]
  );

  if (eventsToRevert.length === 0) {
    console.log(chalk.green('No events to revert - already at target state'));
    closeDb();
    return;
  }

  console.log(chalk.yellow(`Events to revert: ${eventsToRevert.length}`));

  if (options.verbose) {
    for (const event of eventsToRevert) {
      console.log(`  - ${event.action} ${event.entity_type}/${event.entity_id}`);
    }
  }

  console.log('');

  if (options.dryRun) {
    console.log(chalk.yellow('Dry run - no changes made'));
    console.log('');
    console.log('Would revert:');

    // Group by entity type
    const byType: Record<string, number> = {};
    for (const event of eventsToRevert) {
      byType[event.entity_type] = (byType[event.entity_type] || 0) + 1;
    }

    for (const [type, count] of Object.entries(byType)) {
      console.log(`  ${type}: ${count} change(s)`);
    }

    closeDb();
    return;
  }

  // Rollback safety: only domain tables, never raw_ingest/events/coach_sessions
  const protectedEntityTypes = ['raw_ingest', 'events', 'coach_sessions'];
  const skippedEvents = eventsToRevert.filter(
    e => protectedEntityTypes.includes(e.entity_type)
  );

  if (skippedEvents.length > 0) {
    console.log(chalk.yellow(`Skipping ${skippedEvents.length} protected event(s) (raw_ingest, events, coach_sessions)`));
  }

  console.log('');
  console.log(chalk.yellow('Rollback not yet fully implemented'));
  console.log('');
  console.log('This command will:');
  console.log('  1. Revert domain tables to their state at the target event');
  console.log('  2. Create a rollback_applied event (additive, not rewriting history)');
  console.log('  3. Never touch raw_ingest, events, or coach_sessions');
  console.log('  4. Preserve the full audit trail');
  console.log('');
  console.log('Protected tables (never rolled back):');
  console.log('  - raw_ingest (original data for reprocessing)');
  console.log('  - events (audit trail)');
  console.log('  - coach_sessions (decision history)');

  closeDb();
}

export async function listEventsCommand(
  options: { limit?: number; entityType?: string }
): Promise<void> {
  const dbPath = process.env.DATABASE_PATH ?? './data/coach.db';

  if (!isDbInitialized(dbPath)) {
    console.log(chalk.yellow('Database not initialized'));
    console.log(`Run ${chalk.cyan('runnn init')} to create the database`);
    return;
  }

  const limit = options.limit ?? 20;

  let sql = 'SELECT * FROM events';
  const params: unknown[] = [];

  if (options.entityType) {
    sql += ' WHERE entity_type = ?';
    params.push(options.entityType);
  }

  sql += ' ORDER BY timestamp_utc DESC LIMIT ?';
  params.push(limit);

  const events = query<Event>(sql, params);

  if (events.length === 0) {
    console.log(chalk.yellow('No events found'));
    closeDb();
    return;
  }

  console.log(chalk.bold('Recent Events'));
  console.log('');

  for (const event of events) {
    const time = event.timestamp_utc.slice(0, 19).replace('T', ' ');
    const action = event.action.padEnd(8);
    console.log(
      `${chalk.gray(time)} ${chalk.cyan(action)} ${event.entity_type}/${event.entity_id.slice(0, 8)}...`
    );
    if (event.reason) {
      console.log(`  ${chalk.gray(event.reason)}`);
    }
  }

  console.log('');
  console.log(chalk.gray(`Showing ${events.length} of ${limit} requested`));

  closeDb();
}
