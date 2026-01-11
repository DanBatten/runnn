/**
 * Pace Zones - Calculate and manage training pace zones
 *
 * Zones are computed from fitness tests and used for:
 * - Workout prescriptions
 * - Effort validation
 * - Progress tracking
 */

import { query, queryOne, generateId, insertWithEvent, updateWithEvent } from '../db/client.js';
import { getBestRecentTest, estimateVDOT } from './fitness-tests.js';

export interface PaceZones {
  id: string;
  effective_date: string;
  source: string | null;
  // Paces in seconds per mile
  easy_pace_low: number | null;
  easy_pace_high: number | null;
  steady_pace_low: number | null;
  steady_pace_high: number | null;
  tempo_pace_low: number | null;
  tempo_pace_high: number | null;
  threshold_pace: number | null;
  interval_pace: number | null;
  // Heart rate zones
  easy_hr_low: number | null;
  easy_hr_high: number | null;
  tempo_hr_low: number | null;
  tempo_hr_high: number | null;
  threshold_hr: number | null;
  notes: string | null;
}

interface PaceZonesRow {
  id: string;
  effective_date: string;
  source: string | null;
  easy_pace_low: number | null;
  easy_pace_high: number | null;
  steady_pace_low: number | null;
  steady_pace_high: number | null;
  tempo_pace_low: number | null;
  tempo_pace_high: number | null;
  threshold_pace: number | null;
  interval_pace: number | null;
  easy_hr_low: number | null;
  easy_hr_high: number | null;
  tempo_hr_low: number | null;
  tempo_hr_high: number | null;
  threshold_hr: number | null;
  notes: string | null;
}

/**
 * Create pace zones manually
 */
export function createPaceZones(zones: {
  effective_date: string;
  source?: string;
  easy_pace_low?: number;
  easy_pace_high?: number;
  steady_pace_low?: number;
  steady_pace_high?: number;
  tempo_pace_low?: number;
  tempo_pace_high?: number;
  threshold_pace?: number;
  interval_pace?: number;
  easy_hr_low?: number;
  easy_hr_high?: number;
  tempo_hr_low?: number;
  tempo_hr_high?: number;
  threshold_hr?: number;
  notes?: string;
}): string {
  const id = generateId();

  insertWithEvent(
    'pace_zones',
    {
      id,
      effective_date: zones.effective_date,
      source: zones.source ?? 'manual',
      easy_pace_low: zones.easy_pace_low ?? null,
      easy_pace_high: zones.easy_pace_high ?? null,
      steady_pace_low: zones.steady_pace_low ?? null,
      steady_pace_high: zones.steady_pace_high ?? null,
      tempo_pace_low: zones.tempo_pace_low ?? null,
      tempo_pace_high: zones.tempo_pace_high ?? null,
      threshold_pace: zones.threshold_pace ?? null,
      interval_pace: zones.interval_pace ?? null,
      easy_hr_low: zones.easy_hr_low ?? null,
      easy_hr_high: zones.easy_hr_high ?? null,
      tempo_hr_low: zones.tempo_hr_low ?? null,
      tempo_hr_high: zones.tempo_hr_high ?? null,
      threshold_hr: zones.threshold_hr ?? null,
      notes: zones.notes ?? null,
    },
    { source: 'pace_zones_create' }
  );

  return id;
}

/**
 * Calculate and create pace zones from a fitness test
 * Uses simplified Jack Daniels-style zone calculations
 */
export function calculateZonesFromTest(
  testDistanceMeters: number,
  testTimeSeconds: number,
  testHrAvg?: number,
  testHrThreshold?: number
): string {
  const vdot = estimateVDOT(testDistanceMeters, testTimeSeconds);

  // Calculate paces based on VDOT
  // These are simplified approximations of the Daniels tables
  const thresholdPace = calculatePaceFromVDOT(vdot, 0.88); // ~88% vVO2max
  const tempoPaceLow = thresholdPace * 1.02;
  const tempoPaceHigh = thresholdPace * 0.98;
  const steadyPaceLow = thresholdPace * 1.10;
  const steadyPaceHigh = thresholdPace * 1.05;
  const easyPaceLow = thresholdPace * 1.25;
  const easyPaceHigh = thresholdPace * 1.15;
  const intervalPace = thresholdPace * 0.95; // Slightly faster than threshold

  // Estimate HR zones if we have threshold HR
  let hrZones: {
    easy_hr_low?: number;
    easy_hr_high?: number;
    tempo_hr_low?: number;
    tempo_hr_high?: number;
    threshold_hr?: number;
  } = {};

  if (testHrThreshold) {
    hrZones = {
      easy_hr_low: Math.round(testHrThreshold * 0.70),
      easy_hr_high: Math.round(testHrThreshold * 0.80),
      tempo_hr_low: Math.round(testHrThreshold * 0.85),
      tempo_hr_high: Math.round(testHrThreshold * 0.92),
      threshold_hr: testHrThreshold,
    };
  } else if (testHrAvg) {
    // Rough estimate - assume test was at ~threshold
    const estimatedThreshold = testHrAvg;
    hrZones = {
      easy_hr_low: Math.round(estimatedThreshold * 0.70),
      easy_hr_high: Math.round(estimatedThreshold * 0.80),
      tempo_hr_low: Math.round(estimatedThreshold * 0.85),
      tempo_hr_high: Math.round(estimatedThreshold * 0.92),
      threshold_hr: estimatedThreshold,
    };
  }

  const today = new Date().toISOString().split('T')[0];

  return createPaceZones({
    effective_date: today,
    source: `vdot_${Math.round(vdot)}`,
    easy_pace_low: Math.round(easyPaceLow),
    easy_pace_high: Math.round(easyPaceHigh),
    steady_pace_low: Math.round(steadyPaceLow),
    steady_pace_high: Math.round(steadyPaceHigh),
    tempo_pace_low: Math.round(tempoPaceLow),
    tempo_pace_high: Math.round(tempoPaceHigh),
    threshold_pace: Math.round(thresholdPace),
    interval_pace: Math.round(intervalPace),
    ...hrZones,
    notes: `Calculated from VDOT ${vdot.toFixed(1)}`,
  });
}

/**
 * Calculate pace from VDOT at a given percentage of vVO2max
 * Returns seconds per mile
 */
function calculatePaceFromVDOT(vdot: number, percentVO2max: number): number {
  // Simplified calculation
  // At VDOT 50, threshold pace is roughly 6:30/mi (390 sec)
  // Scale inversely with VDOT
  const baseThresholdPace = 390; // seconds per mile at VDOT 50
  const vdotFactor = 50 / vdot;

  const paceAtPercent = baseThresholdPace * vdotFactor / percentVO2max;
  return paceAtPercent;
}

/**
 * Auto-calculate zones from best recent test
 */
export function autoCalculateZones(): string | null {
  const test = getBestRecentTest();
  if (!test || !test.distance_meters || !test.result_time_seconds) {
    return null;
  }

  return calculateZonesFromTest(
    test.distance_meters,
    test.result_time_seconds,
    test.result_hr_avg ?? undefined,
    test.result_hr_threshold ?? undefined
  );
}

/**
 * Get pace zones by ID
 */
export function getPaceZonesById(id: string): PaceZones | null {
  const row = queryOne<PaceZonesRow>(
    'SELECT * FROM pace_zones WHERE id = ?',
    [id]
  );

  return row ? parsePaceZonesRow(row) : null;
}

/**
 * Get current (most recent) pace zones
 */
export function getCurrentPaceZones(): PaceZones | null {
  const today = new Date().toISOString().split('T')[0];
  const row = queryOne<PaceZonesRow>(
    `SELECT * FROM pace_zones
     WHERE effective_date <= ?
     ORDER BY effective_date DESC LIMIT 1`,
    [today]
  );

  return row ? parsePaceZonesRow(row) : null;
}

/**
 * Get pace zones history
 */
export function getPaceZonesHistory(limit: number = 10): PaceZones[] {
  const rows = query<PaceZonesRow>(
    'SELECT * FROM pace_zones ORDER BY effective_date DESC LIMIT ?',
    [limit]
  );

  return rows.map(parsePaceZonesRow);
}

/**
 * Update pace zones
 */
export function updatePaceZones(id: string, updates: Partial<Omit<PaceZones, 'id'>>): void {
  const updateData: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(updates)) {
    if (value !== undefined) {
      updateData[key] = value;
    }
  }

  if (Object.keys(updateData).length > 0) {
    updateWithEvent('pace_zones', id, updateData, { source: 'pace_zones_update' });
  }
}

/**
 * Get pace range for a workout type
 */
export function getPaceRangeForWorkout(
  zones: PaceZones,
  workoutType: string
): { low: number; high: number } | null {
  switch (workoutType.toLowerCase()) {
    case 'easy':
    case 'recovery':
      if (zones.easy_pace_low && zones.easy_pace_high) {
        return { low: zones.easy_pace_high, high: zones.easy_pace_low };
      }
      break;
    case 'steady':
    case 'aerobic':
      if (zones.steady_pace_low && zones.steady_pace_high) {
        return { low: zones.steady_pace_high, high: zones.steady_pace_low };
      }
      break;
    case 'tempo':
      if (zones.tempo_pace_low && zones.tempo_pace_high) {
        return { low: zones.tempo_pace_high, high: zones.tempo_pace_low };
      }
      break;
    case 'threshold':
      if (zones.threshold_pace) {
        return { low: zones.threshold_pace - 5, high: zones.threshold_pace + 5 };
      }
      break;
    case 'interval':
      if (zones.interval_pace) {
        return { low: zones.interval_pace - 10, high: zones.interval_pace + 5 };
      }
      break;
  }
  return null;
}

/**
 * Get HR range for a workout type
 */
export function getHRRangeForWorkout(
  zones: PaceZones,
  workoutType: string
): { low: number; high: number } | null {
  switch (workoutType.toLowerCase()) {
    case 'easy':
    case 'recovery':
      if (zones.easy_hr_low && zones.easy_hr_high) {
        return { low: zones.easy_hr_low, high: zones.easy_hr_high };
      }
      break;
    case 'tempo':
    case 'steady':
      if (zones.tempo_hr_low && zones.tempo_hr_high) {
        return { low: zones.tempo_hr_low, high: zones.tempo_hr_high };
      }
      break;
    case 'threshold':
    case 'interval':
      if (zones.threshold_hr) {
        return { low: zones.threshold_hr - 5, high: zones.threshold_hr + 10 };
      }
      break;
  }
  return null;
}

/**
 * Format pace zones for display
 */
export function formatPaceZones(zones: PaceZones): string {
  const lines: string[] = [
    `Pace Zones (effective ${zones.effective_date})`,
    `Source: ${zones.source ?? 'unknown'}`,
    '',
  ];

  if (zones.easy_pace_low && zones.easy_pace_high) {
    lines.push(`Easy: ${formatPace(zones.easy_pace_high)} - ${formatPace(zones.easy_pace_low)}`);
  }
  if (zones.steady_pace_low && zones.steady_pace_high) {
    lines.push(`Steady: ${formatPace(zones.steady_pace_high)} - ${formatPace(zones.steady_pace_low)}`);
  }
  if (zones.tempo_pace_low && zones.tempo_pace_high) {
    lines.push(`Tempo: ${formatPace(zones.tempo_pace_high)} - ${formatPace(zones.tempo_pace_low)}`);
  }
  if (zones.threshold_pace) {
    lines.push(`Threshold: ${formatPace(zones.threshold_pace)}`);
  }
  if (zones.interval_pace) {
    lines.push(`Interval: ${formatPace(zones.interval_pace)}`);
  }

  if (zones.easy_hr_low || zones.threshold_hr) {
    lines.push('');
    lines.push('Heart Rate Zones:');
    if (zones.easy_hr_low && zones.easy_hr_high) {
      lines.push(`  Easy: ${zones.easy_hr_low} - ${zones.easy_hr_high} bpm`);
    }
    if (zones.tempo_hr_low && zones.tempo_hr_high) {
      lines.push(`  Tempo: ${zones.tempo_hr_low} - ${zones.tempo_hr_high} bpm`);
    }
    if (zones.threshold_hr) {
      lines.push(`  Threshold: ${zones.threshold_hr} bpm`);
    }
  }

  return lines.join('\n');
}

/**
 * Format pace as MM:SS per mile
 */
function formatPace(secPerMile: number): string {
  const mins = Math.floor(secPerMile / 60);
  const secs = Math.floor(secPerMile % 60);
  return `${mins}:${secs.toString().padStart(2, '0')}/mi`;
}

/**
 * Parse a database row into PaceZones
 */
function parsePaceZonesRow(row: PaceZonesRow): PaceZones {
  return {
    id: row.id,
    effective_date: row.effective_date,
    source: row.source,
    easy_pace_low: row.easy_pace_low,
    easy_pace_high: row.easy_pace_high,
    steady_pace_low: row.steady_pace_low,
    steady_pace_high: row.steady_pace_high,
    tempo_pace_low: row.tempo_pace_low,
    tempo_pace_high: row.tempo_pace_high,
    threshold_pace: row.threshold_pace,
    interval_pace: row.interval_pace,
    easy_hr_low: row.easy_hr_low,
    easy_hr_high: row.easy_hr_high,
    tempo_hr_low: row.tempo_hr_low,
    tempo_hr_high: row.tempo_hr_high,
    threshold_hr: row.threshold_hr,
    notes: row.notes,
  };
}
