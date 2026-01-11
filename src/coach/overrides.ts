/**
 * Manual Overrides - Human stays in charge
 *
 * Elegant permanent rules that override automation:
 * - "Ignore HRV for 3 days" (sick, sensor noisy)
 * - "Do long run Saturday this month"
 * - "No intervals until calf calm"
 * - "Max 4 runs this week"
 */

import { query, queryOne, generateId, insertWithEvent, updateWithEvent, deleteWithEvent } from '../db/client.js';

export type OverrideType =
  | 'ignore_metric'      // Ignore a specific metric (HRV, RHR, etc.)
  | 'schedule_change'    // Change workout day preferences
  | 'intensity_limit'    // Limit workout intensity
  | 'volume_limit'       // Limit weekly/daily volume
  | 'workout_block'      // Block specific workout types
  | 'injury_protocol'    // Injury-specific restrictions
  | 'custom';            // Freeform override

export interface Override {
  id: string;
  override_type: OverrideType;
  description: string;
  rules: Record<string, unknown>;
  starts_at: string;
  expires_at: string | null;
  is_active: boolean;
  reason: string | null;
  created_at: string;
}

interface OverrideRow {
  id: string;
  override_type: string;
  description: string;
  rules: string;
  starts_at: string;
  expires_at: string | null;
  is_active: number;
  reason: string | null;
  created_at: string;
}

/**
 * Create a new override
 */
export function createOverride(override: {
  override_type: OverrideType;
  description: string;
  rules: Record<string, unknown>;
  starts_at?: string;
  expires_at?: string;
  reason?: string;
}): string {
  const id = generateId();
  const now = new Date().toISOString();

  insertWithEvent(
    'overrides',
    {
      id,
      override_type: override.override_type,
      description: override.description,
      rules: JSON.stringify(override.rules),
      starts_at: override.starts_at ?? now.split('T')[0],
      expires_at: override.expires_at ?? null,
      is_active: 1,
      reason: override.reason ?? null,
    },
    { source: 'override_create' }
  );

  return id;
}

/**
 * Get override by ID
 */
export function getOverrideById(id: string): Override | null {
  const row = queryOne<OverrideRow>(
    'SELECT * FROM overrides WHERE id = ?',
    [id]
  );

  return row ? parseOverrideRow(row) : null;
}

/**
 * Get all active overrides
 */
export function getActiveOverrides(): Override[] {
  const today = new Date().toISOString().split('T')[0];
  const rows = query<OverrideRow>(
    `SELECT * FROM overrides
     WHERE is_active = 1
     AND starts_at <= ?
     AND (expires_at IS NULL OR expires_at > ?)
     ORDER BY created_at DESC`,
    [today, today]
  );

  return rows.map(parseOverrideRow);
}

/**
 * Get active overrides by type
 */
export function getActiveOverridesByType(type: OverrideType): Override[] {
  const today = new Date().toISOString().split('T')[0];
  const rows = query<OverrideRow>(
    `SELECT * FROM overrides
     WHERE is_active = 1
     AND override_type = ?
     AND starts_at <= ?
     AND (expires_at IS NULL OR expires_at > ?)`,
    [type, today, today]
  );

  return rows.map(parseOverrideRow);
}

/**
 * Get all overrides (including inactive and expired)
 */
export function getAllOverrides(): Override[] {
  const rows = query<OverrideRow>(
    'SELECT * FROM overrides ORDER BY created_at DESC'
  );

  return rows.map(parseOverrideRow);
}

/**
 * Deactivate an override
 */
export function deactivateOverride(id: string): void {
  updateWithEvent(
    'overrides',
    id,
    { is_active: 0 },
    { source: 'override_deactivate' }
  );
}

/**
 * Reactivate an override
 */
export function reactivateOverride(id: string): void {
  updateWithEvent(
    'overrides',
    id,
    { is_active: 1 },
    { source: 'override_reactivate' }
  );
}

/**
 * Extend an override's expiration
 */
export function extendOverride(id: string, newExpiresAt: string): void {
  updateWithEvent(
    'overrides',
    id,
    { expires_at: newExpiresAt },
    { source: 'override_extend' }
  );
}

/**
 * Delete an override permanently
 */
export function deleteOverride(id: string): void {
  deleteWithEvent('overrides', id, { source: 'override_delete' });
}

// ===========================================
// CONVENIENCE FUNCTIONS FOR COMMON OVERRIDES
// ===========================================

/**
 * Ignore a metric for N days
 */
export function ignoreMetric(
  metric: 'hrv' | 'rhr' | 'sleep' | 'body_battery',
  days: number,
  reason?: string
): string {
  const today = new Date();
  const expiresAt = new Date(today);
  expiresAt.setDate(expiresAt.getDate() + days);

  return createOverride({
    override_type: 'ignore_metric',
    description: `Ignore ${metric.toUpperCase()} for ${days} days`,
    rules: { metric, ignore: true },
    expires_at: expiresAt.toISOString().split('T')[0],
    reason,
  });
}

/**
 * Set maximum runs per week
 */
export function limitWeeklyRuns(maxRuns: number, reason?: string): string {
  return createOverride({
    override_type: 'volume_limit',
    description: `Max ${maxRuns} runs per week`,
    rules: { max_runs_per_week: maxRuns },
    reason,
  });
}

/**
 * Set maximum weekly mileage
 */
export function limitWeeklyMileage(maxMiles: number, reason?: string): string {
  return createOverride({
    override_type: 'volume_limit',
    description: `Max ${maxMiles} miles per week`,
    rules: { max_weekly_miles: maxMiles },
    reason,
  });
}

/**
 * Block a workout type until a date or indefinitely
 */
export function blockWorkoutType(
  workoutType: string,
  untilDate?: string,
  reason?: string
): string {
  return createOverride({
    override_type: 'workout_block',
    description: `No ${workoutType} workouts${untilDate ? ` until ${untilDate}` : ''}`,
    rules: { blocked_type: workoutType },
    expires_at: untilDate,
    reason,
  });
}

/**
 * Block all quality workouts (tempo, interval, threshold)
 */
export function blockQualityWorkouts(untilDate?: string, reason?: string): string {
  return createOverride({
    override_type: 'workout_block',
    description: `No quality workouts${untilDate ? ` until ${untilDate}` : ''}`,
    rules: { blocked_types: ['tempo', 'interval', 'threshold'] },
    expires_at: untilDate,
    reason,
  });
}

/**
 * Set preferred long run day
 */
export function setLongRunDay(dayOfWeek: string, reason?: string): string {
  return createOverride({
    override_type: 'schedule_change',
    description: `Long run on ${dayOfWeek}`,
    rules: { long_run_day: dayOfWeek.toLowerCase() },
    reason,
  });
}

/**
 * Create an injury protocol override
 */
export function createInjuryProtocol(
  injuryLocation: string,
  restrictions: {
    max_pace_sec_per_mile?: number;
    max_duration_minutes?: number;
    blocked_types?: string[];
    required_warmup_minutes?: number;
  },
  reason?: string
): string {
  return createOverride({
    override_type: 'injury_protocol',
    description: `Injury protocol for ${injuryLocation}`,
    rules: {
      injury_location: injuryLocation,
      ...restrictions,
    },
    reason: reason ?? `Managing ${injuryLocation} injury`,
  });
}

/**
 * Limit intensity (max effort level)
 */
export function limitIntensity(
  maxIntensity: 'easy' | 'steady' | 'tempo',
  reason?: string
): string {
  const intensityOrder = ['easy', 'steady', 'tempo', 'threshold', 'interval'];
  const maxIndex = intensityOrder.indexOf(maxIntensity);

  return createOverride({
    override_type: 'intensity_limit',
    description: `Max intensity: ${maxIntensity}`,
    rules: {
      max_intensity: maxIntensity,
      blocked_intensities: intensityOrder.slice(maxIndex + 1),
    },
    reason,
  });
}

// ===========================================
// OVERRIDE CHECKING
// ===========================================

/**
 * Check if a metric should be ignored
 */
export function isMetricIgnored(metric: string): boolean {
  const overrides = getActiveOverridesByType('ignore_metric');
  return overrides.some(o => o.rules.metric === metric && o.rules.ignore === true);
}

/**
 * Check if a workout type is blocked
 */
export function isWorkoutTypeBlocked(workoutType: string): boolean {
  const overrides = [
    ...getActiveOverridesByType('workout_block'),
    ...getActiveOverridesByType('injury_protocol'),
  ];

  for (const override of overrides) {
    if (override.rules.blocked_type === workoutType) return true;
    if (Array.isArray(override.rules.blocked_types) &&
        override.rules.blocked_types.includes(workoutType)) return true;
  }

  return false;
}

/**
 * Get maximum weekly runs limit (if any)
 */
export function getWeeklyRunsLimit(): number | null {
  const overrides = getActiveOverridesByType('volume_limit');
  for (const override of overrides) {
    if (typeof override.rules.max_runs_per_week === 'number') {
      return override.rules.max_runs_per_week;
    }
  }
  return null;
}

/**
 * Get maximum weekly mileage limit (if any)
 */
export function getWeeklyMileageLimit(): number | null {
  const overrides = getActiveOverridesByType('volume_limit');
  for (const override of overrides) {
    if (typeof override.rules.max_weekly_miles === 'number') {
      return override.rules.max_weekly_miles;
    }
  }
  return null;
}

/**
 * Get preferred long run day (if set)
 */
export function getLongRunDayPreference(): string | null {
  const overrides = getActiveOverridesByType('schedule_change');
  for (const override of overrides) {
    if (typeof override.rules.long_run_day === 'string') {
      return override.rules.long_run_day;
    }
  }
  return null;
}

/**
 * Get active injury protocol for a location
 */
export function getInjuryProtocol(location: string): Override | null {
  const overrides = getActiveOverridesByType('injury_protocol');
  return overrides.find(o => o.rules.injury_location === location) ?? null;
}

/**
 * Get all active override descriptions (for context)
 */
export function getActiveOverrideDescriptions(): string[] {
  return getActiveOverrides().map(o => o.description);
}

/**
 * Format override for display
 */
export function formatOverride(override: Override): string {
  const lines: string[] = [
    override.description,
    `  Type: ${override.override_type}`,
    `  Active: ${override.is_active ? 'Yes' : 'No'}`,
    `  Starts: ${override.starts_at}`,
  ];

  if (override.expires_at) {
    lines.push(`  Expires: ${override.expires_at}`);
  } else {
    lines.push(`  Expires: Never (permanent)`);
  }

  if (override.reason) {
    lines.push(`  Reason: ${override.reason}`);
  }

  return lines.join('\n');
}

/**
 * Parse a database row into Override
 */
function parseOverrideRow(row: OverrideRow): Override {
  return {
    id: row.id,
    override_type: row.override_type as OverrideType,
    description: row.description,
    rules: JSON.parse(row.rules),
    starts_at: row.starts_at,
    expires_at: row.expires_at,
    is_active: row.is_active === 1,
    reason: row.reason,
    created_at: row.created_at,
  };
}
