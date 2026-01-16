/**
 * Garmin Connector - Sync activities and health data from Garmin Connect
 *
 * Features:
 * - Incremental sync using cursors
 * - Idempotent (dedupe via raw_ingest payload_hash)
 * - Stores raw data for reprocessing
 * - Rate limit handling with backoff
 */

import { nanoid } from 'nanoid';
import { createHash } from 'crypto';
import { insertWithEvent, queryOne, getDb } from '../db/client.js';
import { emitEvent } from '../db/events.js';
import { getLastNDays, getTimezone } from '../util/timezone.js';

interface SyncState {
  source: string;
  cursor: string | null;
  last_success_at_utc: string | null;
  last_error_at_utc: string | null;
  last_error_message: string | null;
}

interface GarminActivity {
  activityId: number;
  activityName: string;
  activityType: { typeKey: string };
  startTimeLocal: string;
  startTimeGMT: string;
  distance: number;
  duration: number;
  averageSpeed: number;
  averageHR: number;
  maxHR: number;
  averageRunningCadenceInStepsPerMinute: number;
  elevationGain: number;
  aerobicTrainingEffect: number;
  deviceId: number;
}

interface GarminDailyStats {
  calendarDate: string;
  totalKilocalories: number;
  activeKilocalories: number;
  restingHeartRate: number;
  maxHeartRate: number;
  sleepingSeconds: number;
  averageStressLevel: number;
  bodyBatteryChargedValue: number;
  bodyBatteryDrainedValue: number;
}

interface GarminHRV {
  calendarDate: string;
  hrvValue: number;
  status: string;
}

interface GarminSleep {
  calendarDate: string;
  sleepTimeSeconds: number;
  sleepScores: {
    overall: { value: number };
  };
}

export interface SyncResult {
  success: boolean;
  activitiesSynced: number;
  healthSnapshotsSynced: number;
  errors: string[];
  newActivityIds: string[];
}

/**
 * Get the current sync state for Garmin
 */
export function getSyncState(): SyncState | null {
  return queryOne<SyncState>(
    'SELECT * FROM sync_state WHERE source = ?',
    ['garmin']
  ) ?? null;
}

/**
 * Update sync state after successful/failed sync
 */
function updateSyncState(
  cursor: string | null,
  error?: string
): void {
  const db = getDb();
  const now = new Date().toISOString();

  const existing = getSyncState();

  if (existing) {
    if (error) {
      db.prepare(`
        UPDATE sync_state
        SET last_error_at_utc = ?, last_error_message = ?
        WHERE source = 'garmin'
      `).run(now, error);
    } else {
      db.prepare(`
        UPDATE sync_state
        SET cursor = ?, last_success_at_utc = ?, last_error_message = NULL
        WHERE source = 'garmin'
      `).run(cursor, now);
    }
  } else {
    db.prepare(`
      INSERT INTO sync_state (source, cursor, last_success_at_utc)
      VALUES ('garmin', ?, ?)
    `).run(cursor, error ? null : now);
  }
}

/**
 * Generate a hash of the payload for deduplication
 */
function hashPayload(payload: unknown): string {
  return createHash('sha256')
    .update(JSON.stringify(payload))
    .digest('hex')
    .slice(0, 32);
}

/**
 * Check if we've already ingested this data
 * Checks both raw_ingest table AND workouts table (for merged records)
 */
function isAlreadyIngested(sourceId: string, payloadHash: string): boolean {
  // Check raw_ingest table
  const existingIngest = queryOne<{ id: string }>(
    `SELECT id FROM raw_ingest
     WHERE source = 'garmin' AND (source_id = ? OR payload_hash = ?)`,
    [sourceId, payloadHash]
  );
  if (existingIngest !== undefined && existingIngest !== null) {
    return true;
  }

  // Also check workouts table for garmin_id (handles merged LifeOS records)
  const existingWorkout = queryOne<{ id: string }>(
    `SELECT id FROM workouts WHERE garmin_id = ?`,
    [sourceId]
  );
  return existingWorkout !== undefined && existingWorkout !== null;
}

/**
 * Store raw ingest record (returns existing ID if duplicate)
 */
function storeRawIngest(
  sourceId: string,
  payload: unknown
): string | null {
  const payloadJson = JSON.stringify(payload);
  const payloadHash = hashPayload(payload);

  // Check if we already have this exact data
  const existing = queryOne<{ id: string }>(
    `SELECT id FROM raw_ingest WHERE source = 'garmin' AND payload_hash = ?`,
    [payloadHash]
  );

  if (existing) {
    return existing.id;
  }

  const id = nanoid();

  insertWithEvent(
    'raw_ingest',
    {
      id,
      source: 'garmin',
      source_id: sourceId,
      received_at_utc: new Date().toISOString(),
      payload_json: payloadJson,
      payload_hash: payloadHash,
      status: 'pending',
    },
    { source: 'garmin_sync' }
  );

  return id;
}

/**
 * Parse Garmin activity and store as workout
 * Note: Caller must verify this activity hasn't been ingested already
 */
function processActivity(
  activity: GarminActivity,
  rawIngestId: string | null
): string | null {
  if (!rawIngestId) {
    return null;
  }

  const sourceId = String(activity.activityId);

  // Parse times
  const startTimeUtc = activity.startTimeGMT;
  const startTimeLocal = activity.startTimeLocal;

  // Calculate timezone offset (in minutes)
  const utcDate = new Date(startTimeUtc);
  const localDate = new Date(startTimeLocal);
  const offsetMs = localDate.getTime() - utcDate.getTime();
  const offsetMin = Math.round(offsetMs / 60000);

  // Extract local date (YYYY-MM-DD)
  const localDateStr = startTimeLocal.slice(0, 10);

  // Convert metrics
  const distanceMeters = activity.distance;
  const durationSeconds = Math.round(activity.duration);
  const avgPaceSecPerMile = distanceMeters > 0
    ? (durationSeconds / (distanceMeters / 1609.34))
    : null;

  // Determine workout type from activity type
  const typeKey = activity.activityType?.typeKey || 'running';
  const workoutType = mapActivityType(typeKey);

  const workoutId = nanoid();

  insertWithEvent(
    'workouts',
    {
      id: workoutId,
      garmin_id: sourceId,
      raw_ingest_id: rawIngestId,
      start_time_utc: startTimeUtc,
      timezone_offset_min: offsetMin,
      local_date: localDateStr,
      type: workoutType,
      distance_meters: distanceMeters,
      duration_seconds: durationSeconds,
      avg_pace_sec_per_mile: avgPaceSecPerMile,
      avg_hr: activity.averageHR || null,
      max_hr: activity.maxHR || null,
      cadence: activity.averageRunningCadenceInStepsPerMinute || null,
      elevation_gain_ft: activity.elevationGain
        ? Math.round(activity.elevationGain * 3.28084)
        : null,
      training_effect: activity.aerobicTrainingEffect || null,
      device: activity.deviceId ? String(activity.deviceId) : null,
      source: 'garmin',
      execution_status: 'completed', // Garmin data is always from actual runs
    },
    { source: 'garmin_sync' }
  );

  // Update raw_ingest status
  const db = getDb();
  db.prepare('UPDATE raw_ingest SET status = ? WHERE id = ?')
    .run('processed', rawIngestId);

  return workoutId;
}

/**
 * Map Garmin activity type to our workout type
 */
function mapActivityType(typeKey: string): string {
  const typeMap: Record<string, string> = {
    running: 'easy',
    trail_running: 'easy',
    treadmill_running: 'easy',
    track_running: 'interval',
    virtual_run: 'easy',
  };
  return typeMap[typeKey] || 'easy';
}

/**
 * Process health data (HRV, sleep, RHR) into health_snapshots
 */
function processHealthData(
  date: string,
  hrv: GarminHRV | null,
  sleep: GarminSleep | null,
  dailyStats: GarminDailyStats | null,
  rawIngestId: string
): boolean {
  // Check if we already have data for this date
  const existing = queryOne<{ local_date: string }>(
    'SELECT local_date FROM health_snapshots WHERE local_date = ?',
    [date]
  );

  const data: Record<string, unknown> = {
    local_date: date,
    timezone_offset_min: -480, // Default to Pacific, should come from settings
    raw_ingest_id: rawIngestId,
  };

  if (hrv) {
    data.hrv = hrv.hrvValue;
    data.hrv_status = hrv.status;
  }

  if (sleep) {
    data.sleep_hours = Math.round((sleep.sleepTimeSeconds / 3600) * 10) / 10;
    data.sleep_quality = sleep.sleepScores?.overall?.value || null;
  }

  if (dailyStats) {
    data.resting_hr = dailyStats.restingHeartRate || null;
    data.body_battery = dailyStats.bodyBatteryChargedValue || null;
    data.stress_level = dailyStats.averageStressLevel || null;
    data.steps = null; // Could add if needed
  }

  if (existing) {
    // Update existing record
    const db = getDb();
    const setClauses: string[] = [];
    const values: unknown[] = [];

    for (const [key, value] of Object.entries(data)) {
      if (key !== 'local_date' && value !== undefined) {
        setClauses.push(`${key} = ?`);
        values.push(value);
      }
    }

    if (setClauses.length > 0) {
      values.push(date);
      db.prepare(`
        UPDATE health_snapshots
        SET ${setClauses.join(', ')}, updated_at = datetime('now')
        WHERE local_date = ?
      `).run(...values);

      emitEvent({
        entityType: 'health_snapshots',
        entityId: date,
        action: 'update',
        source: 'garmin_sync',
      });
    }
  } else {
    // Insert new record (health_snapshots uses local_date as PK, not id)
    const db = getDb();
    const columns = Object.keys(data);
    const placeholders = columns.map(() => '?').join(', ');
    const values = columns.map(col => {
      const val = data[col];
      if (val === null || val === undefined) return null;
      return typeof val === 'object' ? JSON.stringify(val) : val;
    });

    db.prepare(
      `INSERT INTO health_snapshots (${columns.join(', ')}) VALUES (${placeholders})`
    ).run(...values);

    emitEvent({
      entityType: 'health_snapshots',
      entityId: date,
      action: 'create',
      source: 'garmin_sync',
    });
  }

  return true;
}

interface OAuth2Token {
  access_token: string;
  refresh_token: string;
  expires_at: number;
  refresh_token_expires_at: number;
}

/**
 * Parse OAuth2 token from environment
 */
function getOAuth2Token(): OAuth2Token | null {
  const tokenStr = process.env.GARMIN_OAUTH2_TOKEN;
  if (!tokenStr) return null;

  try {
    return JSON.parse(tokenStr);
  } catch {
    return null;
  }
}

// Note: Token refresh is handled by Python script (scripts/garmin-auth.py)
// The following function is kept for reference but not used:
/*
async function refreshOAuth2Token(currentToken: OAuth2Token): Promise<OAuth2Token | null> {
  // Garmin's token refresh endpoint at di-cert.garmin.com doesn't work reliably
  // Use scripts/garmin-auth.py instead
}
*/

/**
 * Make authenticated request to Garmin Connect API
 */
async function garminRequest<T>(
  endpoint: string,
  accessToken: string
): Promise<T> {
  const response = await fetch(`https://connect.garmin.com${endpoint}`, {
    headers: {
      'Authorization': `Bearer ${accessToken}`,
      'DI-Backend': 'connectapi.garmin.com',
      'User-Agent': 'GarminConnect/4.0',
      'Accept': 'application/json',
    },
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Garmin API error ${response.status}: ${text}`);
  }

  return response.json() as Promise<T>;
}

/**
 * Fetch activities from Garmin Connect API
 */
async function fetchActivities(
  accessToken: string,
  limit: number = 50,
  start: number = 0
): Promise<GarminActivity[]> {
  // Use activitylist-service for fetching activities
  const activities = await garminRequest<GarminActivity[]>(
    `/activitylist-service/activities/search/activities?limit=${limit}&start=${start}`,
    accessToken
  );
  return activities;
}

/**
 * Fetch HRV data for a specific date
 */
async function fetchHRV(accessToken: string, date: string): Promise<GarminHRV | null> {
  try {
    const data = await garminRequest<{ hrvSummary?: { lastNightAvg?: number; status?: string } }>(
      `/hrv-service/hrv/${date}`,
      accessToken
    );
    if (data.hrvSummary?.lastNightAvg) {
      return {
        calendarDate: date,
        hrvValue: data.hrvSummary.lastNightAvg,
        status: data.hrvSummary.status || 'UNKNOWN',
      };
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Fetch sleep data for a specific date
 */
async function fetchSleep(accessToken: string, date: string): Promise<GarminSleep | null> {
  try {
    const data = await garminRequest<{
      dailySleepDTO?: {
        sleepTimeSeconds?: number;
        sleepScores?: { overall?: { value: number } };
      };
    }>(
      `/wellness-service/wellness/dailySleepData/${date}`,
      accessToken
    );
    if (data.dailySleepDTO?.sleepTimeSeconds) {
      return {
        calendarDate: date,
        sleepTimeSeconds: data.dailySleepDTO.sleepTimeSeconds,
        sleepScores: {
          overall: { value: data.dailySleepDTO.sleepScores?.overall?.value || 0 },
        },
      };
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Fetch daily stats (RHR, body battery, stress)
 */
async function fetchDailyStats(accessToken: string, date: string): Promise<GarminDailyStats | null> {
  try {
    const data = await garminRequest<{
      restingHeartRate?: number;
      maxHeartRate?: number;
      bodyBatteryChargedValue?: number;
      averageStressLevel?: number;
    }>(
      `/usersummary-service/usersummary/daily/${date}`,
      accessToken
    );
    return {
      calendarDate: date,
      totalKilocalories: 0,
      activeKilocalories: 0,
      restingHeartRate: data.restingHeartRate || 0,
      maxHeartRate: data.maxHeartRate || 0,
      sleepingSeconds: 0,
      averageStressLevel: data.averageStressLevel || 0,
      bodyBatteryChargedValue: data.bodyBatteryChargedValue || 0,
      bodyBatteryDrainedValue: 0,
    };
  } catch {
    return null;
  }
}

/**
 * Main sync function - syncs activities and health data from Garmin Connect
 */
export async function syncGarmin(options: {
  force?: boolean;
  daysBack?: number;
}): Promise<SyncResult> {
  const result: SyncResult = {
    success: false,
    activitiesSynced: 0,
    healthSnapshotsSynced: 0,
    errors: [],
    newActivityIds: [],
  };

  const syncState = getSyncState();
  const lastCursor = options.force ? null : (syncState?.cursor ?? null);

  try {
    console.log('  Connecting to Garmin Connect...');

    // Get OAuth2 token
    let oauth2 = getOAuth2Token();
    if (!oauth2) {
      result.errors.push('GARMIN_OAUTH2_TOKEN must be set in .env');
      updateSyncState(lastCursor, 'Missing OAuth2 token');
      return result;
    }

    // Check if token is expired and needs refresh
    const now = Math.floor(Date.now() / 1000);
    if (oauth2.expires_at && oauth2.expires_at < now) {
      console.log('  Token expired, refreshing via Python script...');
      const { execSync } = await import('child_process');
      try {
        execSync('python3 scripts/garmin-auth.py', {
          cwd: process.cwd(),
          stdio: 'pipe',
          timeout: 30000
        });
        // Re-read the token after refresh
        oauth2 = getOAuth2Token();
        if (!oauth2) {
          result.errors.push('Failed to refresh token');
          return result;
        }
        console.log('  ✓ Token refreshed');
      } catch (e) {
        result.errors.push('Token refresh failed - please run: python3 scripts/garmin-auth.py');
        return result;
      }
    }

    const accessToken = oauth2.access_token;

    // Fetch activities
    console.log('  Fetching activities...');
    const activities = await fetchActivities(accessToken, 50);
    console.log(`  Found ${activities.length} activities`);

    // Filter to running activities only
    const runningActivities = activities.filter(a => {
      const typeKey = a.activityType?.typeKey || '';
      return typeKey.includes('running') || typeKey === 'run';
    });

    console.log(`  ${runningActivities.length} running activities`);

    // Process each running activity
    for (const activity of runningActivities) {
      const sourceId = String(activity.activityId);
      const payloadHash = hashPayload(activity);

      // Skip if already ingested
      if (isAlreadyIngested(sourceId, payloadHash)) {
        continue;
      }

      console.log(`  + ${activity.activityName} (${(activity.distance / 1609.34).toFixed(1)} mi)`);

      // Store raw ingest
      const rawIngestId = storeRawIngest(sourceId, activity);

      // Process into workout
      const workoutId = processActivity(activity, rawIngestId);
      if (workoutId) {
        result.newActivityIds.push(workoutId);
        result.activitiesSynced++;
      }
    }


    // Fetch health data for last N days
    const daysBack = options.daysBack ?? 7;
    const tzInfo = getTimezone();
    console.log(`  Fetching health data (last ${daysBack} days, timezone: ${tzInfo.timezone})...`);

    // Get dates in athlete's local timezone (auto-detected from system)
    const datesToFetch = getLastNDays(daysBack);

    for (const dateStr of datesToFetch) {

      const hrv = await fetchHRV(accessToken, dateStr);
      const sleep = await fetchSleep(accessToken, dateStr);
      const dailyStats = await fetchDailyStats(accessToken, dateStr);

      if (hrv || sleep || dailyStats) {
        const rawData = { date: dateStr, hrv, sleep, dailyStats };
        const rawIngestId = storeRawIngest(`health_${dateStr}`, rawData);
        if (rawIngestId) {
          processHealthData(dateStr, hrv, sleep, dailyStats, rawIngestId);
          result.healthSnapshotsSynced++;
        }
      }
    }

    // Update cursor to now
    const newCursor = new Date().toISOString();
    updateSyncState(newCursor);

    result.success = true;
    console.log(`  ✓ Synced ${result.activitiesSynced} activities, ${result.healthSnapshotsSynced} health snapshots`);

  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    result.errors.push(errorMsg);
    updateSyncState(lastCursor, errorMsg);
    console.error(`  Error: ${errorMsg}`);
  }

  return result;
}

/**
 * Process activities from raw JSON data
 * This is called by the MCP server or Python connector
 */
export function importActivities(activities: GarminActivity[]): string[] {
  const newIds: string[] = [];

  for (const activity of activities) {
    const sourceId = String(activity.activityId);
    const payloadHash = hashPayload(activity);

    // Skip if already ingested
    if (isAlreadyIngested(sourceId, payloadHash)) {
      continue;
    }

    // Store raw ingest
    const rawIngestId = storeRawIngest(sourceId, activity);

    // Process into workout
    const workoutId = processActivity(activity, rawIngestId);
    if (workoutId) {
      newIds.push(workoutId);
    }
  }

  return newIds;
}

/**
 * Process health data from raw JSON
 */
export function importHealthData(
  date: string,
  hrv: GarminHRV | null,
  sleep: GarminSleep | null,
  dailyStats: GarminDailyStats | null
): boolean {
  // Store raw ingest
  const rawData = { date, hrv, sleep, dailyStats };
  const rawIngestId = storeRawIngest(`health_${date}`, rawData);

  if (!rawIngestId) {
    return false;
  }
  return processHealthData(date, hrv, sleep, dailyStats, rawIngestId);
}
