/**
 * Sync API - Sync Garmin data and process voice notes
 *
 * Write operation with idempotency and single-writer discipline.
 */

import {
  ApiEnvelope,
  SyncResult,
  WriteParams,
  generateTraceId,
  success,
  timeOperation,
} from './types.js';
import { withWriteLock } from './concurrency.js';
import { syncGarmin, getSyncState } from '../connectors/garmin.js';
import { processRunNotes, scanInbox } from '../connectors/run-notes.js';

export interface SyncParams extends WriteParams {
  garmin?: boolean;
  notes?: boolean;
  force?: boolean;
}

/**
 * Sync all data sources (Garmin + notes)
 */
export async function syncAll(params: SyncParams): Promise<ApiEnvelope<SyncResult>> {
  const trace_id = generateTraceId();
  const {
    garmin = true,
    notes = true,
    force = false,
    idempotency_key,
    dry_run = false,
  } = params;

  return timeOperation(trace_id, async () => {
    // Dry run - just preview what would happen
    if (dry_run) {
      const preview = await previewSync({ garmin, notes });
      return success<SyncResult>(preview, trace_id, { dry_run: true });
    }

    // Use write lock with idempotency
    const { result, cached } = await withWriteLock<SyncResult>(
      'sync',
      trace_id,
      idempotency_key,
      async () => {
        const syncResult: SyncResult = {
          garmin: { activities: 0, health_snapshots: 0 },
          notes: { processed: 0, matched: 0 },
          events_created: 0,
        };

        // Sync Garmin
        if (garmin) {
          const garminResult = await syncGarmin({ force });
          if (garminResult.success) {
            syncResult.garmin.activities = garminResult.activitiesSynced;
            syncResult.garmin.health_snapshots = garminResult.healthSnapshotsSynced;
            syncResult.events_created +=
              garminResult.activitiesSynced + garminResult.healthSnapshotsSynced;
          }
        }

        // Sync notes
        if (notes) {
          const pendingNotes = scanInbox();
          if (pendingNotes.length > 0) {
            const notesResult = await processRunNotes({ autoLink: true });
            syncResult.notes.processed = notesResult.notesProcessed;
            syncResult.notes.matched = notesResult.notesLinked;
            syncResult.events_created += notesResult.notesLinked;
          }
        }

        return syncResult;
      }
    );

    return success<SyncResult>(result, trace_id, { cached });
  });
}

/**
 * Preview what sync would do without making changes
 */
async function previewSync(params: {
  garmin?: boolean;
  notes?: boolean;
}): Promise<SyncResult> {
  const preview: SyncResult = {
    garmin: { activities: 0, health_snapshots: 0 },
    notes: { processed: 0, matched: 0 },
    events_created: 0,
  };

  if (params.garmin) {
    // Check Garmin sync state to estimate pending activities
    // In a real preview, we'd query the Garmin API for new activities
    // For now, just indicate sync is available
    preview.garmin.activities = -1; // -1 indicates "unknown, will check"
  }

  if (params.notes) {
    const pendingNotes = scanInbox();
    preview.notes.processed = pendingNotes.length;
  }

  return preview;
}

/**
 * Get current sync status
 */
export async function getSyncStatus(): Promise<ApiEnvelope<{
  garmin_last_sync: string | null;
  garmin_cursor: string | null;
  pending_notes: number;
}>> {
  const trace_id = generateTraceId();

  return timeOperation(trace_id, async () => {
    const syncState = getSyncState();
    const pendingNotes = scanInbox();

    return success(
      {
        garmin_last_sync: syncState?.last_success_at_utc ?? null,
        garmin_cursor: syncState?.cursor ?? null,
        pending_notes: pendingNotes.length,
      },
      trace_id
    );
  });
}
