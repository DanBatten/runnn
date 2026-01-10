/**
 * Context Loading - Smart retrieval of relevant data for coaching
 *
 * Loads and filters context to provide the coach with:
 * - Current readiness state
 * - Recent training history
 * - Relevant patterns and knowledge
 * - Active overrides
 * - Planned workouts
 */

import { query, queryOne } from '../db/client.js';
import { getRelevantKnowledge, formatKnowledge } from './knowledge.js';
import { getLessonsLearned } from './decisions.js';
import { getActivePolicies } from '../policy/loader.js';
import type { PolicyContext } from '../policy/types.js';

/**
 * Health snapshot from database
 */
interface HealthSnapshot {
  local_date: string;
  sleep_hours: number | null;
  sleep_quality: number | null;
  hrv: number | null;
  hrv_status: string | null;
  resting_hr: number | null;
  body_battery: number | null;
  stress_level: number | null;
}

/**
 * Readiness baseline from database
 */
interface ReadinessBaseline {
  local_date: string;
  hrv_7day_avg: number | null;
  rhr_7day_avg: number | null;
  sleep_7day_avg: number | null;
  hrv_30day_avg: number | null;
  rhr_30day_avg: number | null;
  sleep_30day_avg: number | null;
}

/**
 * Workout from database
 */
interface Workout {
  id: string;
  local_date: string;
  type: string | null;
  distance_meters: number | null;
  duration_seconds: number | null;
  avg_pace_sec_per_mile: number | null;
  avg_hr: number | null;
  perceived_exertion: number | null;
  personal_notes: string | null;
  execution_score: number | null;
}

/**
 * Planned workout from database
 */
interface PlannedWorkout {
  id: string;
  local_date: string;
  type: string | null;
  priority: string | null;
  target_distance_meters: number | null;
  target_duration_seconds: number | null;
  prescription: string | null;
  rationale: string | null;
  status: string;
}

/**
 * Override from database
 */
interface Override {
  id: string;
  override_type: string;
  description: string;
  rules: string;
  starts_at: string;
  expires_at: string | null;
  reason: string | null;
}

/**
 * Injury status from database
 */
interface InjuryStatus {
  id: string;
  local_date: string;
  location: string;
  severity: number;
  trend: string | null;
  limits_running: number;
  notes: string | null;
}

/**
 * Life event from database
 */
interface LifeEvent {
  id: string;
  local_date: string;
  event_type: string;
  severity: number | null;
  duration_days: number | null;
  timezone_change_hours: number | null;
  notes: string | null;
}

/**
 * Full context pack for coaching
 */
export interface CoachContext {
  // Date context
  today: string;
  day_of_week: string;

  // Health & readiness
  current_health: HealthSnapshot | null;
  readiness_baseline: ReadinessBaseline | null;
  readiness_deltas: {
    hrv_delta_pct: number | null;
    rhr_delta_pct: number | null;
    sleep_delta_pct: number | null;
  };

  // Training
  planned_workout: PlannedWorkout | null;
  recent_workouts: Workout[];
  weekly_mileage: number;
  weekly_mileage_prev: number;
  weekly_ramp_pct: number | null;

  // Life context
  active_injury: InjuryStatus | null;
  recent_life_events: LifeEvent[];
  travel_days_ago: number | null;
  timezone_change_hours: number | null;

  // Knowledge & patterns
  relevant_knowledge: string[];
  recent_lessons: string[];

  // Overrides
  active_overrides: Override[];
  override_names: string[];

  // Policies
  active_policy_count: number;
}

/**
 * Load full context for a given date
 */
export function loadContext(date?: string): CoachContext {
  const today = date ?? new Date().toISOString().split('T')[0];
  const dayOfWeek = new Date(today).toLocaleDateString('en-US', { weekday: 'long' }).toLowerCase();

  // Load health snapshot
  const currentHealth = queryOne<HealthSnapshot>(
    'SELECT * FROM health_snapshots WHERE local_date = ?',
    [today]
  );

  // Load readiness baseline
  const baseline = queryOne<ReadinessBaseline>(
    'SELECT * FROM readiness_baselines WHERE local_date = ? ORDER BY local_date DESC LIMIT 1',
    [today]
  ) ?? queryOne<ReadinessBaseline>(
    'SELECT * FROM readiness_baselines ORDER BY local_date DESC LIMIT 1'
  );

  // Calculate readiness deltas
  const readinessDeltas = calculateReadinessDeltas(currentHealth ?? null, baseline ?? null);

  // Load planned workout for today
  const plannedWorkout = queryOne<PlannedWorkout>(
    'SELECT * FROM planned_workouts WHERE local_date = ? AND status = ?',
    [today, 'planned']
  );

  // Load recent workouts (last 14 days)
  const twoWeeksAgo = subtractDays(today, 14);
  const recentWorkouts = query<Workout>(
    'SELECT * FROM workouts WHERE local_date >= ? ORDER BY local_date DESC',
    [twoWeeksAgo]
  );

  // Calculate weekly mileage
  const weekStart = getWeekStart(today);
  const prevWeekStart = subtractDays(weekStart, 7);

  const thisWeekMileage = calculateWeeklyMileage(weekStart, today);
  const prevWeekMileage = calculateWeeklyMileage(prevWeekStart, subtractDays(weekStart, 1));

  const weeklyRampPct = prevWeekMileage > 0
    ? ((thisWeekMileage - prevWeekMileage) / prevWeekMileage) * 100
    : null;

  // Load active injury
  const activeInjury = queryOne<InjuryStatus>(
    `SELECT * FROM injury_status
     WHERE limits_running = 1 OR severity >= 4
     ORDER BY local_date DESC LIMIT 1`
  );

  // Load recent life events
  const recentLifeEvents = query<LifeEvent>(
    'SELECT * FROM life_events WHERE local_date >= ? ORDER BY local_date DESC',
    [subtractDays(today, 7)]
  );

  // Find travel info
  const recentTravel = recentLifeEvents.find(e => e.event_type === 'travel');
  const travelDaysAgo = recentTravel
    ? daysBetween(recentTravel.local_date, today)
    : null;
  const timezoneChangeHours = recentTravel?.timezone_change_hours ?? null;

  // Load relevant knowledge
  const knowledge = getRelevantKnowledge({
    workout_type: plannedWorkout?.type ?? undefined,
    day_of_week: dayOfWeek,
    has_injury: activeInjury !== null,
    travel_days_ago: travelDaysAgo ?? undefined,
  });

  // Load recent lessons
  const lessons = getLessonsLearned(5);

  // Load active overrides
  const activeOverrides = query<Override>(
    `SELECT * FROM overrides
     WHERE is_active = 1
     AND starts_at <= ?
     AND (expires_at IS NULL OR expires_at > ?)`,
    [today, today]
  );

  // Get active policy count
  const policies = getActivePolicies();

  return {
    today,
    day_of_week: dayOfWeek,

    current_health: currentHealth ?? null,
    readiness_baseline: baseline ?? null,
    readiness_deltas: readinessDeltas,

    planned_workout: plannedWorkout ?? null,
    recent_workouts: recentWorkouts,
    weekly_mileage: thisWeekMileage,
    weekly_mileage_prev: prevWeekMileage,
    weekly_ramp_pct: weeklyRampPct,

    active_injury: activeInjury ?? null,
    recent_life_events: recentLifeEvents,
    travel_days_ago: travelDaysAgo,
    timezone_change_hours: timezoneChangeHours,

    relevant_knowledge: knowledge.map(formatKnowledge),
    recent_lessons: lessons.map(l => l.lesson),

    active_overrides: activeOverrides,
    override_names: activeOverrides.map(o => o.description),

    active_policy_count: policies.length,
  };
}

/**
 * Convert CoachContext to PolicyContext for policy evaluation
 */
export function toPolicyContext(context: CoachContext): PolicyContext {
  return {
    // Health metrics
    sleep_hours: context.current_health?.sleep_hours ?? undefined,
    sleep_quality: context.current_health?.sleep_quality ?? undefined,
    hrv: context.current_health?.hrv ?? undefined,
    hrv_status: context.current_health?.hrv_status ?? undefined,
    rhr: context.current_health?.resting_hr ?? undefined,
    body_battery: context.current_health?.body_battery ?? undefined,

    // Deltas from baseline
    hrv_delta_pct: context.readiness_deltas.hrv_delta_pct ?? undefined,
    rhr_delta_pct: context.readiness_deltas.rhr_delta_pct ?? undefined,
    sleep_delta_pct: context.readiness_deltas.sleep_delta_pct ?? undefined,

    // Training load
    weekly_mileage: context.weekly_mileage,
    weekly_mileage_prev: context.weekly_mileage_prev,
    weekly_ramp_pct: context.weekly_ramp_pct ?? undefined,
    days_since_last_run: context.recent_workouts.length > 0
      ? daysBetween(context.recent_workouts[0].local_date, context.today)
      : undefined,
    consecutive_hard_days: countConsecutiveHardDays(context.recent_workouts),

    // Planned workout
    planned_workout_type: context.planned_workout?.type ?? undefined,
    planned_distance_meters: context.planned_workout?.target_distance_meters ?? undefined,
    planned_duration_seconds: context.planned_workout?.target_duration_seconds ?? undefined,

    // Injury context
    active_injury_severity: context.active_injury?.severity ?? undefined,
    active_injury_location: context.active_injury?.location ?? undefined,
    injury_trend: (context.active_injury?.trend as 'improving' | 'stable' | 'worsening' | undefined) ?? undefined,

    // Life context
    travel_days_ago: context.travel_days_ago ?? undefined,
    timezone_change_hours: context.timezone_change_hours ?? undefined,

    // Overrides
    active_overrides: context.override_names,
  };
}

/**
 * Generate a compact context summary for logging
 */
export function summarizeContext(context: CoachContext): string {
  const parts: string[] = [];

  // Health summary
  if (context.current_health) {
    const h = context.current_health;
    if (h.sleep_hours) parts.push(`sleep: ${h.sleep_hours}hr`);
    if (h.hrv && context.readiness_deltas.hrv_delta_pct !== null) {
      parts.push(`HRV: ${h.hrv} (${context.readiness_deltas.hrv_delta_pct > 0 ? '+' : ''}${context.readiness_deltas.hrv_delta_pct.toFixed(0)}%)`);
    }
    if (h.resting_hr && context.readiness_deltas.rhr_delta_pct !== null) {
      parts.push(`RHR: ${h.resting_hr} (${context.readiness_deltas.rhr_delta_pct > 0 ? '+' : ''}${context.readiness_deltas.rhr_delta_pct.toFixed(0)}%)`);
    }
  }

  // Training summary
  parts.push(`weekly: ${metersToMiles(context.weekly_mileage).toFixed(1)}mi`);
  if (context.weekly_ramp_pct !== null) {
    parts.push(`ramp: ${context.weekly_ramp_pct > 0 ? '+' : ''}${context.weekly_ramp_pct.toFixed(0)}%`);
  }

  // Planned workout
  if (context.planned_workout) {
    parts.push(`planned: ${context.planned_workout.type ?? 'workout'}`);
  }

  // Injury
  if (context.active_injury) {
    parts.push(`injury: ${context.active_injury.location} (${context.active_injury.severity}/10)`);
  }

  // Travel
  if (context.travel_days_ago !== null && context.travel_days_ago <= 3) {
    parts.push(`travel: ${context.travel_days_ago}d ago`);
    if (context.timezone_change_hours) {
      parts.push(`tz: ${context.timezone_change_hours}hr`);
    }
  }

  // Overrides
  if (context.active_overrides.length > 0) {
    parts.push(`overrides: ${context.active_overrides.length}`);
  }

  return parts.join(' | ');
}

/**
 * Calculate readiness deltas from baseline
 */
function calculateReadinessDeltas(
  current: HealthSnapshot | null,
  baseline: ReadinessBaseline | null
): { hrv_delta_pct: number | null; rhr_delta_pct: number | null; sleep_delta_pct: number | null } {
  if (!current || !baseline) {
    return { hrv_delta_pct: null, rhr_delta_pct: null, sleep_delta_pct: null };
  }

  const hrvDelta = current.hrv && baseline.hrv_7day_avg
    ? ((current.hrv - baseline.hrv_7day_avg) / baseline.hrv_7day_avg) * 100
    : null;

  const rhrDelta = current.resting_hr && baseline.rhr_7day_avg
    ? ((current.resting_hr - baseline.rhr_7day_avg) / baseline.rhr_7day_avg) * 100
    : null;

  const sleepDelta = current.sleep_hours && baseline.sleep_7day_avg
    ? ((current.sleep_hours - baseline.sleep_7day_avg) / baseline.sleep_7day_avg) * 100
    : null;

  return {
    hrv_delta_pct: hrvDelta,
    rhr_delta_pct: rhrDelta,
    sleep_delta_pct: sleepDelta,
  };
}

/**
 * Calculate weekly mileage for a date range
 */
function calculateWeeklyMileage(startDate: string, endDate: string): number {
  const result = queryOne<{ total: number }>(
    `SELECT COALESCE(SUM(distance_meters), 0) as total
     FROM workouts
     WHERE local_date >= ? AND local_date <= ?`,
    [startDate, endDate]
  );

  return result?.total ?? 0;
}

/**
 * Count consecutive days with hard workouts
 */
function countConsecutiveHardDays(workouts: Workout[]): number {
  const hardTypes = ['tempo', 'interval', 'threshold', 'race', 'long'];
  let count = 0;

  // Sort by date descending
  const sorted = [...workouts].sort((a, b) =>
    b.local_date.localeCompare(a.local_date)
  );

  for (const workout of sorted) {
    if (workout.type && hardTypes.includes(workout.type)) {
      count++;
    } else {
      break;
    }
  }

  return count;
}

/**
 * Get the Monday of the week containing the given date
 */
function getWeekStart(date: string): string {
  const d = new Date(date);
  const day = d.getDay();
  const diff = d.getDate() - day + (day === 0 ? -6 : 1);
  d.setDate(diff);
  return d.toISOString().split('T')[0];
}

/**
 * Subtract days from a date string
 */
function subtractDays(date: string, days: number): string {
  const d = new Date(date);
  d.setDate(d.getDate() - days);
  return d.toISOString().split('T')[0];
}

/**
 * Calculate days between two date strings
 */
function daysBetween(date1: string, date2: string): number {
  const d1 = new Date(date1);
  const d2 = new Date(date2);
  const diffTime = Math.abs(d2.getTime() - d1.getTime());
  return Math.floor(diffTime / (1000 * 60 * 60 * 24));
}

/**
 * Convert meters to miles
 */
function metersToMiles(meters: number): number {
  return meters / 1609.344;
}
