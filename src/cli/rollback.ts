/**
 * Rollback command - Revert to a previous state via event sourcing
 *
 * Safety rules:
 * - Rollbacks are additive (create rollback_applied event, not rewrite history)
 * - Protected tables never rolled back: raw_ingest, events, coach_sessions
 * - Domain tables can be rolled back: workouts, planned_workouts, decisions, patterns, etc.
 */

import chalk from 'chalk';
import { isDbInitialized, closeDb, query, queryOne, execute, generateId } from '../db/client.js';

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

// Tables that can be rolled back
const ROLLBACKABLE_TABLES = new Set([
  'workouts',
  'planned_workouts',
  'health_snapshots',
  'coaching_decisions',
  'discovered_patterns',
  'athlete_knowledge',
  'overrides',
  'training_plans',
  'training_blocks',
  'races',
  'fitness_tests',
  'pace_zones',
  'life_events',
  'strength_sessions',
  'injury_status',
  'policies',
  'weekly_summaries',
  'readiness_baselines',
  'daily_training_load',
  'data_issues',
]);

// Tables that are NEVER rolled back (audit trail)
const PROTECTED_TABLES = new Set([
  'raw_ingest',
  'events',
  'coach_sessions',
  'schema_versions',
  'prompt_versions',
  'sync_state',
]);

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

  // Filter to only rollbackable events
  const rollbackableEvents = eventsToRevert.filter(
    e => ROLLBACKABLE_TABLES.has(e.entity_type)
  );

  const skippedEvents = eventsToRevert.filter(
    e => PROTECTED_TABLES.has(e.entity_type)
  );

  if (skippedEvents.length > 0) {
    console.log(chalk.yellow(`Skipping ${skippedEvents.length} protected event(s)`));
    if (options.verbose) {
      for (const event of skippedEvents) {
        console.log(chalk.gray(`  - ${event.entity_type}/${event.entity_id}`));
      }
    }
  }

  if (rollbackableEvents.length === 0) {
    console.log(chalk.yellow('No rollbackable events found'));
    closeDb();
    return;
  }

  console.log(chalk.blue(`Rollbackable events: ${rollbackableEvents.length}`));
  console.log('');

  // Process rollbacks in reverse chronological order
  const rollbackResults = {
    success: 0,
    failed: 0,
    skipped: 0,
  };

  for (const event of rollbackableEvents) {
    const result = await revertEvent(event, options.verbose);
    if (result === 'success') {
      rollbackResults.success++;
    } else if (result === 'failed') {
      rollbackResults.failed++;
    } else {
      rollbackResults.skipped++;
    }
  }

  // Record the rollback as an event itself
  const rollbackEventId = generateId();
  execute(
    `INSERT INTO events (id, timestamp_utc, entity_type, entity_id, action, source, reason, diff_json)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      rollbackEventId,
      new Date().toISOString(),
      'rollback',
      targetEvent.id,
      'rollback_applied',
      'cli_rollback',
      `Rolled back to event ${targetEvent.id}`,
      JSON.stringify({
        target_event_id: targetEvent.id,
        target_timestamp: targetEvent.timestamp_utc,
        events_reverted: rollbackableEvents.length,
        events_skipped: skippedEvents.length,
        results: rollbackResults,
      }),
    ]
  );

  console.log('');
  console.log(chalk.bold('Rollback Summary'));
  console.log('─'.repeat(40));
  console.log(chalk.green(`  Reverted: ${rollbackResults.success}`));
  if (rollbackResults.failed > 0) {
    console.log(chalk.red(`  Failed: ${rollbackResults.failed}`));
  }
  if (rollbackResults.skipped > 0) {
    console.log(chalk.yellow(`  Skipped: ${rollbackResults.skipped}`));
  }
  console.log('');
  console.log(chalk.gray(`Rollback event recorded: ${rollbackEventId}`));

  closeDb();
}

/**
 * Revert a single event
 */
async function revertEvent(
  event: Event,
  verbose?: boolean
): Promise<'success' | 'failed' | 'skipped'> {
  try {
    const tableName = event.entity_type;
    const entityId = event.entity_id;

    switch (event.action) {
      case 'create':
      case 'insert':
        // For create events, delete the entity
        if (verbose) {
          console.log(chalk.gray(`  Deleting ${tableName}/${entityId}`));
        }
        execute(`DELETE FROM ${tableName} WHERE id = ?`, [entityId]);
        return 'success';

      case 'update':
        // For update events, restore previous state from diff_json
        if (!event.diff_json) {
          if (verbose) {
            console.log(chalk.yellow(`  No diff data for ${tableName}/${entityId}, skipping`));
          }
          return 'skipped';
        }

        const diff = JSON.parse(event.diff_json);

        // Check if we have before values
        if (!diff.before) {
          if (verbose) {
            console.log(chalk.yellow(`  No before state for ${tableName}/${entityId}, skipping`));
          }
          return 'skipped';
        }

        // Build UPDATE statement from before values
        const beforeKeys = Object.keys(diff.before);
        if (beforeKeys.length === 0) {
          return 'skipped';
        }

        const setClause = beforeKeys.map(k => `${k} = ?`).join(', ');
        const values = beforeKeys.map(k => {
          const val = diff.before[k];
          return typeof val === 'object' ? JSON.stringify(val) : val;
        });

        if (verbose) {
          console.log(chalk.gray(`  Restoring ${tableName}/${entityId} (${beforeKeys.join(', ')})`));
        }

        execute(
          `UPDATE ${tableName} SET ${setClause} WHERE id = ?`,
          [...values, entityId]
        );
        return 'success';

      case 'delete':
        // For delete events, we cannot easily restore without full row data
        // This would require having stored the full row in diff_json
        if (!event.diff_json) {
          if (verbose) {
            console.log(chalk.yellow(`  Cannot restore deleted ${tableName}/${entityId} - no data`));
          }
          return 'skipped';
        }

        const deletedData = JSON.parse(event.diff_json);
        if (!deletedData.deleted_row) {
          if (verbose) {
            console.log(chalk.yellow(`  Cannot restore deleted ${tableName}/${entityId} - incomplete data`));
          }
          return 'skipped';
        }

        // Reconstruct INSERT statement
        const row = deletedData.deleted_row;
        const columns = Object.keys(row);
        const placeholders = columns.map(() => '?').join(', ');
        const insertValues = columns.map(k => {
          const val = row[k];
          return typeof val === 'object' ? JSON.stringify(val) : val;
        });

        if (verbose) {
          console.log(chalk.gray(`  Restoring deleted ${tableName}/${entityId}`));
        }

        execute(
          `INSERT INTO ${tableName} (${columns.join(', ')}) VALUES (${placeholders})`,
          insertValues
        );
        return 'success';

      default:
        if (verbose) {
          console.log(chalk.yellow(`  Unknown action "${event.action}" for ${tableName}/${entityId}`));
        }
        return 'skipped';
    }
  } catch (err) {
    if (verbose) {
      console.log(chalk.red(`  Error reverting ${event.entity_type}/${event.entity_id}: ${err}`));
    }
    return 'failed';
  }
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
