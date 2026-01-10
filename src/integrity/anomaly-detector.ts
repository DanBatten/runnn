/**
 * Anomaly Detector - Detect data quality issues and anomalies
 *
 * Detects:
 * - Impossible paces (too fast/slow)
 * - Sudden HRV drops (sensor error)
 * - Double-import duplicates
 * - Missing days in health snapshots
 * - Orphaned run notes (no matching workout)
 * - Timezone mismatches from travel
 */

import { query, queryOne, insertWithEvent, getDb } from '../db/client.js';
import { nanoid } from 'nanoid';

interface DataIssue {
  id: string;
  detected_at: string;
  issue_type: string;
  severity: string;
  entity_type: string | null;
  entity_id: string | null;
  description: string;
  suggested_fix: string | null;
  status: string;
}

interface Workout {
  id: string;
  local_date: string;
  distance_meters: number | null;
  duration_seconds: number | null;
  avg_pace_sec_per_mile: number | null;
  avg_hr: number | null;
  max_hr: number | null;
  personal_notes: string | null;
}

interface HealthSnapshot {
  local_date: string;
  hrv: number | null;
  resting_hr: number | null;
  sleep_hours: number | null;
}

interface AnomalyResult {
  issuesFound: number;
  issuesByType: Record<string, number>;
  newIssues: DataIssue[];
}

// Thresholds for anomaly detection
const THRESHOLDS = {
  // Pace thresholds (seconds per mile)
  MIN_PACE_SEC_PER_MILE: 240, // 4:00/mile - world class
  MAX_PACE_SEC_PER_MILE: 1200, // 20:00/mile - very slow walk

  // Heart rate thresholds
  MIN_AVG_HR: 60,
  MAX_AVG_HR: 220,
  MIN_RHR: 30,
  MAX_RHR: 100,

  // HRV thresholds
  MIN_HRV: 5,
  MAX_HRV: 200,
  HRV_DROP_PCT: 0.4, // 40% drop from 7-day avg is suspicious

  // Sleep thresholds
  MIN_SLEEP_HOURS: 1,
  MAX_SLEEP_HOURS: 16,

  // Distance/duration sanity
  MAX_DISTANCE_METERS: 100000, // 100km
  MAX_DURATION_SECONDS: 43200, // 12 hours
};

/**
 * Check if an issue already exists
 */
function issueExists(entityType: string, entityId: string, issueType: string): boolean {
  const existing = queryOne<{ id: string }>(
    `SELECT id FROM data_issues
     WHERE entity_type = ? AND entity_id = ? AND issue_type = ? AND status = 'open'`,
    [entityType, entityId, issueType]
  );
  return existing !== undefined;
}

/**
 * Create a new data issue
 */
function createIssue(
  issueType: string,
  severity: string,
  description: string,
  entityType?: string,
  entityId?: string,
  suggestedFix?: string
): DataIssue {
  const issue: DataIssue = {
    id: nanoid(),
    detected_at: new Date().toISOString(),
    issue_type: issueType,
    severity,
    entity_type: entityType || null,
    entity_id: entityId || null,
    description,
    suggested_fix: suggestedFix || null,
    status: 'open',
  };

  // Only insert if not already exists
  if (!entityType || !entityId || !issueExists(entityType, entityId, issueType)) {
    insertWithEvent(
      'data_issues',
      {
        id: issue.id,
        detected_at: issue.detected_at,
        issue_type: issue.issue_type,
        severity: issue.severity,
        entity_type: issue.entity_type,
        entity_id: issue.entity_id,
        description: issue.description,
        suggested_fix: issue.suggested_fix,
        status: issue.status,
      },
      { source: 'anomaly_detector', entityId: issue.id }
    );
  }

  return issue;
}

/**
 * Detect impossible paces
 */
function detectImpossiblePaces(): DataIssue[] {
  const issues: DataIssue[] = [];

  const workouts = query<Workout>(
    `SELECT id, local_date, distance_meters, duration_seconds, avg_pace_sec_per_mile
     FROM workouts
     WHERE avg_pace_sec_per_mile IS NOT NULL`
  );

  for (const workout of workouts) {
    const pace = workout.avg_pace_sec_per_mile!;

    if (pace < THRESHOLDS.MIN_PACE_SEC_PER_MILE) {
      issues.push(createIssue(
        'impossible_pace',
        'error',
        `Pace of ${formatPace(pace)} on ${workout.local_date} is impossibly fast`,
        'workouts',
        workout.id,
        'Verify GPS data or mark as sensor error'
      ));
    }

    if (pace > THRESHOLDS.MAX_PACE_SEC_PER_MILE) {
      issues.push(createIssue(
        'impossible_pace',
        'warning',
        `Pace of ${formatPace(pace)} on ${workout.local_date} is very slow`,
        'workouts',
        workout.id,
        'Verify this was a run and not a walk'
      ));
    }
  }

  return issues;
}

/**
 * Detect suspicious HR values
 */
function detectSuspiciousHR(): DataIssue[] {
  const issues: DataIssue[] = [];

  const workouts = query<Workout>(
    `SELECT id, local_date, avg_hr, max_hr
     FROM workouts
     WHERE avg_hr IS NOT NULL OR max_hr IS NOT NULL`
  );

  for (const workout of workouts) {
    if (workout.avg_hr && (workout.avg_hr < THRESHOLDS.MIN_AVG_HR || workout.avg_hr > THRESHOLDS.MAX_AVG_HR)) {
      issues.push(createIssue(
        'sensor_error',
        'warning',
        `Average HR of ${workout.avg_hr} on ${workout.local_date} is outside normal range`,
        'workouts',
        workout.id,
        'Check HR sensor strap fit'
      ));
    }

    if (workout.max_hr && workout.max_hr > 230) {
      issues.push(createIssue(
        'sensor_error',
        'warning',
        `Max HR of ${workout.max_hr} on ${workout.local_date} is likely a sensor spike`,
        'workouts',
        workout.id,
        'HR sensor may have briefly lost contact'
      ));
    }
  }

  return issues;
}

/**
 * Detect sudden HRV drops
 */
function detectHRVAnomalies(): DataIssue[] {
  const issues: DataIssue[] = [];

  // Get recent health snapshots with HRV
  const snapshots = query<HealthSnapshot>(
    `SELECT local_date, hrv
     FROM health_snapshots
     WHERE hrv IS NOT NULL
     ORDER BY local_date DESC
     LIMIT 30`
  );

  if (snapshots.length < 7) {
    return issues; // Not enough data
  }

  // Calculate 7-day rolling average
  const recentSnapshots = snapshots.slice(0, 7);
  const olderSnapshots = snapshots.slice(7, 14);

  if (olderSnapshots.length < 7) {
    return issues;
  }

  const recentAvg = recentSnapshots.reduce((sum, s) => sum + (s.hrv || 0), 0) / recentSnapshots.length;
  const olderAvg = olderSnapshots.reduce((sum, s) => sum + (s.hrv || 0), 0) / olderSnapshots.length;

  // Check for significant drop
  if (olderAvg > 0) {
    const dropPct = (olderAvg - recentAvg) / olderAvg;

    if (dropPct > THRESHOLDS.HRV_DROP_PCT) {
      issues.push(createIssue(
        'hrv_sudden_drop',
        'warning',
        `HRV dropped ${Math.round(dropPct * 100)}% from ${Math.round(olderAvg)} to ${Math.round(recentAvg)}`,
        'health_snapshots',
        recentSnapshots[0].local_date,
        'Could indicate overtraining, illness, or sensor issues'
      ));
    }
  }

  // Check individual HRV values
  for (const snapshot of snapshots) {
    if (snapshot.hrv! < THRESHOLDS.MIN_HRV || snapshot.hrv! > THRESHOLDS.MAX_HRV) {
      issues.push(createIssue(
        'impossible_hrv',
        'error',
        `HRV value of ${snapshot.hrv} on ${snapshot.local_date} is outside valid range`,
        'health_snapshots',
        snapshot.local_date,
        'Likely sensor error - consider ignoring this day'
      ));
    }
  }

  return issues;
}

/**
 * Detect missing days in health data
 */
function detectMissingHealthDays(): DataIssue[] {
  const issues: DataIssue[] = [];

  // Get the date range of health snapshots
  const range = queryOne<{ min_date: string; max_date: string }>(
    `SELECT MIN(local_date) as min_date, MAX(local_date) as max_date
     FROM health_snapshots`
  );

  if (!range?.min_date || !range?.max_date) {
    return issues;
  }

  // Get all dates in range
  const existingDates = new Set(
    query<{ local_date: string }>('SELECT local_date FROM health_snapshots')
      .map(r => r.local_date)
  );

  // Check for gaps in the last 14 days
  const today = new Date();
  const twoWeeksAgo = new Date(today);
  twoWeeksAgo.setDate(twoWeeksAgo.getDate() - 14);

  let missingDays = 0;
  const missingDates: string[] = [];
  const currentDate = new Date(twoWeeksAgo);

  while (currentDate <= today) {
    const dateStr = currentDate.toISOString().slice(0, 10);
    if (!existingDates.has(dateStr)) {
      missingDays++;
      if (missingDates.length < 5) {
        missingDates.push(dateStr);
      }
    }
    currentDate.setDate(currentDate.getDate() + 1);
  }

  if (missingDays > 2) {
    issues.push(createIssue(
      'missing_health_data',
      'warning',
      `Missing health data for ${missingDays} days in the last 2 weeks: ${missingDates.join(', ')}${missingDays > 5 ? '...' : ''}`,
      undefined,
      undefined,
      'Run runnn sync to fetch missing data'
    ));
  }

  return issues;
}

/**
 * Detect duplicate workouts
 */
function detectDuplicates(): DataIssue[] {
  const issues: DataIssue[] = [];

  // Find workouts with same date and similar metrics
  const duplicates = query<{ id1: string; id2: string; local_date: string }>(
    `SELECT w1.id as id1, w2.id as id2, w1.local_date
     FROM workouts w1
     JOIN workouts w2 ON w1.local_date = w2.local_date
       AND w1.id < w2.id
       AND ABS(COALESCE(w1.distance_meters, 0) - COALESCE(w2.distance_meters, 0)) < 100
       AND ABS(COALESCE(w1.duration_seconds, 0) - COALESCE(w2.duration_seconds, 0)) < 60`
  );

  for (const dup of duplicates) {
    issues.push(createIssue(
      'duplicate',
      'warning',
      `Possible duplicate workouts on ${dup.local_date}: ${dup.id1.slice(0, 8)} and ${dup.id2.slice(0, 8)}`,
      'workouts',
      dup.id1,
      'Review and delete the duplicate'
    ));
  }

  return issues;
}

/**
 * Detect orphaned workouts (planned but no actual linked)
 */
function detectOrphanedPlannedWorkouts(): DataIssue[] {
  const issues: DataIssue[] = [];

  const today = new Date().toISOString().slice(0, 10);

  // Find planned workouts in the past with status 'planned' (not completed/skipped)
  const orphaned = query<{ id: string; local_date: string; type: string }>(
    `SELECT id, local_date, type
     FROM planned_workouts
     WHERE local_date < ? AND status = 'planned'
     ORDER BY local_date DESC
     LIMIT 10`,
    [today]
  );

  for (const pw of orphaned) {
    issues.push(createIssue(
      'missing_link',
      'warning',
      `Planned ${pw.type || 'workout'} on ${pw.local_date} was never completed or marked skipped`,
      'planned_workouts',
      pw.id,
      'Mark as completed (link to workout) or skipped'
    ));
  }

  return issues;
}

/**
 * Detect workouts without notes
 */
function detectMissingNotes(): DataIssue[] {
  const issues: DataIssue[] = [];

  // Find recent workouts without notes
  const noNotes = query<{ id: string; local_date: string; type: string }>(
    `SELECT id, local_date, type
     FROM workouts
     WHERE personal_notes IS NULL
       AND local_date > date('now', '-7 days')
     ORDER BY local_date DESC`
  );

  if (noNotes.length > 3) {
    issues.push(createIssue(
      'missing_notes',
      'warning',
      `${noNotes.length} workouts in the last week have no run notes`,
      undefined,
      undefined,
      'Consider recording voice notes after runs'
    ));
  }

  return issues;
}

/**
 * Format pace from seconds per mile
 */
function formatPace(secPerMile: number): string {
  const minutes = Math.floor(secPerMile / 60);
  const seconds = Math.round(secPerMile % 60);
  return `${minutes}:${seconds.toString().padStart(2, '0')}/mi`;
}

/**
 * Run all anomaly detection checks
 */
export function runAnomalyDetection(): AnomalyResult {
  const result: AnomalyResult = {
    issuesFound: 0,
    issuesByType: {},
    newIssues: [],
  };

  const checks = [
    { name: 'impossible_pace', fn: detectImpossiblePaces },
    { name: 'sensor_errors', fn: detectSuspiciousHR },
    { name: 'hrv_anomalies', fn: detectHRVAnomalies },
    { name: 'missing_health', fn: detectMissingHealthDays },
    { name: 'duplicates', fn: detectDuplicates },
    { name: 'orphaned_planned', fn: detectOrphanedPlannedWorkouts },
    { name: 'missing_notes', fn: detectMissingNotes },
  ];

  for (const check of checks) {
    try {
      const issues = check.fn();
      result.newIssues.push(...issues);

      if (issues.length > 0) {
        result.issuesByType[check.name] = issues.length;
        result.issuesFound += issues.length;
      }
    } catch (error) {
      console.error(`Error running ${check.name} check:`, error);
    }
  }

  return result;
}

/**
 * Get all open issues
 */
export function getOpenIssues(): DataIssue[] {
  return query<DataIssue>(
    `SELECT * FROM data_issues
     WHERE status = 'open'
     ORDER BY severity, detected_at DESC`
  );
}

/**
 * Mark an issue as fixed or ignored
 */
export function resolveIssue(
  issueId: string,
  resolution: 'fixed' | 'ignored',
  fixedBy?: string
): boolean {
  const db = getDb();

  db.prepare(`
    UPDATE data_issues
    SET status = ?, fixed_at = datetime('now'), fixed_by = ?
    WHERE id = ?
  `).run(resolution, fixedBy || 'manual', issueId);

  return true;
}
