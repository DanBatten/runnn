/**
 * Context Packs - Pre-summarized context for the coach
 *
 * Instead of loading raw rows, the coach loads pre-built context packs
 * that are token-efficient and contain exactly what's needed for decisions.
 */

import { queryOne } from '../db/client.js';
import { calculateReadinessDeltas, getReadinessStatus } from './baselines.js';
import { getLoadTrends, getDailyLoad } from './training-load.js';
import { computeWeeklySummary, getRecentWeeklySummaries } from './weekly-summary.js';
import { getActivePatterns, getRelevantPatterns } from '../coach/patterns.js';
import { getActiveOverrideDescriptions } from '../coach/overrides.js';
import { getUpcomingRaces } from '../coach/races.js';
import { getCurrentPaceZones } from '../coach/pace-zones.js';
import { getRecentLifeEvents, getActiveInjuries } from '../coach/life-context.js';

export interface MorningContextPack {
  date: string;
  readiness: {
    status: 'optimal' | 'normal' | 'suboptimal' | 'poor' | 'unknown';
    score: number;
    factors: string[];
    hrv: { value: number | null; vs_baseline: number | null };
    rhr: { value: number | null; vs_baseline: number | null };
    sleep: { value: number | null; vs_baseline: number | null };
  };
  load: {
    status: string;
    acwr: number;
    acute: number;
    chronic: number;
    weekly_so_far: number;
  };
  planned_workout: {
    type: string;
    description: string;
    priority: string;
    target_distance_miles: number | null;
    target_pace_per_mile: string | null;
  } | null;
  active_overrides: string[];
  active_injuries: Array<{ location: string; severity: number; trend: string | null }>;
  recent_life_events: Array<{ type: string; description: string }>;
  patterns_applicable: string[];
}

export interface PostRunContextPack {
  date: string;
  workout: {
    type: string;
    distance_miles: number;
    duration_minutes: number;
    avg_pace_per_mile: string;
    avg_hr: number | null;
    rpe: number | null;
    notes: string | null;
  } | null;
  planned_vs_actual: {
    had_plan: boolean;
    distance_diff_pct: number | null;
    pace_diff_sec: number | null;
    execution_notes: string;
  };
  load_impact: {
    today_load: number;
    weekly_total: number;
    acwr_after: number;
  };
  readiness_before: {
    status: string;
    score: number;
  };
}

export interface WeeklyPlanningContextPack {
  week_start: string;
  last_week: {
    distance_miles: number;
    run_count: number;
    adherence_pct: number;
    load_total: number;
    intensity_distribution: {
      easy: number;
      steady: number;
      tempo: number;
      threshold: number;
      interval: number;
      long: number;
      race: number;
      other: number;
    };
  };
  rolling_4_weeks: {
    avg_weekly_miles: number;
    avg_weekly_runs: number;
    trend: 'building' | 'maintaining' | 'reducing';
  };
  current_phase: string | null;
  upcoming_race: {
    name: string;
    date: string;
    distance: string;
    priority: string;
    weeks_out: number;
  } | null;
  pace_zones: {
    easy: string;
    tempo: string;
    threshold: string;
    interval: string;
  } | null;
  constraints: {
    overrides: string[];
    injuries: Array<{ location: string; severity: number }>;
    life_events: Array<{ date: string; type: string }>;
  };
  active_patterns: string[];
}

/**
 * Build morning context pack for a given date
 */
export function buildMorningContextPack(date: string): MorningContextPack {
  // Get readiness data
  const deltas = calculateReadinessDeltas(date);
  const readinessStatus = getReadinessStatus(date);

  // Get load trends
  const loadTrends = getLoadTrends(date);

  // Get today's planned workout
  const plannedWorkout = queryOne<{
    type: string;
    priority: string;
    prescription: string | null;
    target_distance_meters: number | null;
    target_pace_sec_per_mile: number | null;
  }>(
    `SELECT type, priority, prescription, target_distance_meters, target_pace_sec_per_mile
     FROM planned_workouts
     WHERE local_date = ? AND status = 'planned'
     LIMIT 1`,
    [date]
  );

  // Get active overrides
  const overrideDescriptions = getActiveOverrideDescriptions();

  // Get active injuries
  const injuries = getActiveInjuries().map(i => ({
    location: i.location,
    severity: i.severity,
    trend: i.trend,
  }));

  // Get recent life events (last 7 days)
  const lifeEvents = getRecentLifeEvents(7).map(e => ({
    type: e.event_type,
    description: e.notes || e.event_type,
  }));

  // Get relevant patterns
  const context = {
    hrv_delta: deltas?.hrv_vs_7day ?? 0,
    sleep_hours: deltas?.sleep_value ?? 7,
    rhr_delta: deltas?.rhr_vs_7day ?? 0,
    acwr: loadTrends.acwr,
  };
  const relevantPatterns = getRelevantPatterns(context);
  const patternDescriptions = relevantPatterns.map(p => p.description);

  return {
    date,
    readiness: {
      status: readinessStatus.status,
      score: readinessStatus.score,
      factors: readinessStatus.factors,
      hrv: {
        value: deltas?.hrv_value ?? null,
        vs_baseline: deltas?.hrv_vs_7day ?? null,
      },
      rhr: {
        value: deltas?.rhr_value ?? null,
        vs_baseline: deltas?.rhr_vs_7day ?? null,
      },
      sleep: {
        value: deltas?.sleep_value ?? null,
        vs_baseline: deltas?.sleep_vs_7day ?? null,
      },
    },
    load: {
      status: loadTrends.status,
      acwr: loadTrends.acwr,
      acute: loadTrends.acute_load,
      chronic: loadTrends.chronic_load,
      weekly_so_far: loadTrends.weekly_total,
    },
    planned_workout: plannedWorkout ? {
      type: plannedWorkout.type || 'run',
      description: plannedWorkout.prescription || `${plannedWorkout.type} run`,
      priority: plannedWorkout.priority || 'B',
      target_distance_miles: plannedWorkout.target_distance_meters
        ? Math.round(plannedWorkout.target_distance_meters / 1609.34 * 10) / 10
        : null,
      target_pace_per_mile: plannedWorkout.target_pace_sec_per_mile
        ? formatPace(plannedWorkout.target_pace_sec_per_mile)
        : null,
    } : null,
    active_overrides: overrideDescriptions,
    active_injuries: injuries,
    recent_life_events: lifeEvents,
    patterns_applicable: patternDescriptions,
  };
}

/**
 * Build post-run context pack
 */
export function buildPostRunContextPack(date: string): PostRunContextPack {
  // Get today's workout
  const workout = queryOne<{
    type: string;
    distance_meters: number;
    duration_seconds: number;
    avg_pace_sec_per_mile: number | null;
    avg_hr: number | null;
    perceived_exertion: number | null;
    personal_notes: string | null;
  }>(
    `SELECT type, distance_meters, duration_seconds, avg_pace_sec_per_mile,
            avg_hr, perceived_exertion, personal_notes
     FROM workouts
     WHERE local_date = ?
     ORDER BY start_time_utc DESC
     LIMIT 1`,
    [date]
  );

  // Get planned workout for comparison
  const planned = queryOne<{
    target_distance_meters: number | null;
    target_pace_sec_per_mile: number | null;
  }>(
    `SELECT target_distance_meters, target_pace_sec_per_mile
     FROM planned_workouts
     WHERE local_date = ?`,
    [date]
  );

  // Calculate planned vs actual
  let distanceDiff: number | null = null;
  let paceDiff: number | null = null;
  let executionNotes = 'No planned workout to compare';

  if (planned && workout) {
    if (planned.target_distance_meters && workout.distance_meters) {
      distanceDiff = Math.round(
        ((workout.distance_meters - planned.target_distance_meters) / planned.target_distance_meters) * 100
      );
    }
    if (planned.target_pace_sec_per_mile && workout.avg_pace_sec_per_mile) {
      paceDiff = Math.round(workout.avg_pace_sec_per_mile - planned.target_pace_sec_per_mile);
    }

    if (distanceDiff !== null && Math.abs(distanceDiff) <= 5 && paceDiff !== null && Math.abs(paceDiff) <= 10) {
      executionNotes = 'Workout executed as planned';
    } else if (distanceDiff !== null && distanceDiff < -10) {
      executionNotes = 'Cut short from plan';
    } else if (paceDiff !== null && paceDiff < -15) {
      executionNotes = 'Faster than planned';
    } else if (paceDiff !== null && paceDiff > 15) {
      executionNotes = 'Slower than planned';
    } else {
      executionNotes = 'Close to plan with minor variations';
    }
  }

  // Get load impact
  const dailyLoad = getDailyLoad(date);
  const loadTrends = getLoadTrends(date);

  // Get morning readiness
  const readinessStatus = getReadinessStatus(date);

  return {
    date,
    workout: workout ? {
      type: workout.type || 'run',
      distance_miles: Math.round(workout.distance_meters / 1609.34 * 10) / 10,
      duration_minutes: Math.round(workout.duration_seconds / 60),
      avg_pace_per_mile: formatPace(workout.avg_pace_sec_per_mile ?? 0),
      avg_hr: workout.avg_hr,
      rpe: workout.perceived_exertion,
      notes: workout.personal_notes,
    } : null,
    planned_vs_actual: {
      had_plan: planned !== null,
      distance_diff_pct: distanceDiff,
      pace_diff_sec: paceDiff,
      execution_notes: executionNotes,
    },
    load_impact: {
      today_load: dailyLoad.total_load,
      weekly_total: loadTrends.weekly_total,
      acwr_after: loadTrends.acwr,
    },
    readiness_before: {
      status: readinessStatus.status,
      score: readinessStatus.score,
    },
  };
}

/**
 * Build weekly planning context pack
 */
export function buildWeeklyPlanningContextPack(weekStartDate: string): WeeklyPlanningContextPack {
  // Get last week's summary
  const lastWeekStart = new Date(weekStartDate);
  lastWeekStart.setDate(lastWeekStart.getDate() - 7);
  const lastWeekSummary = computeWeeklySummary(lastWeekStart.toISOString().split('T')[0]);

  // Get rolling 4-week data
  const recentWeeks = getRecentWeeklySummaries(4);
  const avgWeeklyMiles = recentWeeks.length > 0
    ? recentWeeks.reduce((sum, w) => sum + w.total_distance_miles, 0) / recentWeeks.length
    : 0;
  const avgWeeklyRuns = recentWeeks.length > 0
    ? recentWeeks.reduce((sum, w) => sum + w.run_count, 0) / recentWeeks.length
    : 0;

  // Determine trend
  let trend: 'building' | 'maintaining' | 'reducing' = 'maintaining';
  if (recentWeeks.length >= 2) {
    const recent = recentWeeks.slice(0, 2).reduce((sum, w) => sum + w.total_distance_miles, 0) / 2;
    const older = recentWeeks.slice(2, 4).reduce((sum, w) => sum + w.total_distance_miles, 0) / Math.max(1, recentWeeks.slice(2, 4).length);
    if (recent > older * 1.05) trend = 'building';
    else if (recent < older * 0.95) trend = 'reducing';
  }

  // Get current training block/phase
  const currentBlock = queryOne<{ name: string; block_type: string }>(
    `SELECT name, block_type FROM training_blocks
     WHERE start_local_date <= ? AND end_local_date >= ?
     LIMIT 1`,
    [weekStartDate, weekStartDate]
  );

  // Get upcoming race
  const upcomingRaces = getUpcomingRaces();
  const nextRace = upcomingRaces.length > 0 ? upcomingRaces[0] : null;
  let weeksOut: number | null = null;
  if (nextRace) {
    const raceDate = new Date(nextRace.race_date);
    const weekStart = new Date(weekStartDate);
    weeksOut = Math.ceil((raceDate.getTime() - weekStart.getTime()) / (7 * 24 * 60 * 60 * 1000));
  }

  // Get pace zones
  const zones = getCurrentPaceZones();

  // Get constraints
  const overrides = getActiveOverrideDescriptions();
  const injuries = getActiveInjuries().map(i => ({
    location: i.location,
    severity: i.severity,
  }));
  const lifeEvents = getRecentLifeEvents(14).map(e => ({
    date: e.local_date,
    type: e.event_type,
  }));

  // Get active patterns
  const activePatterns = getActivePatterns().map(p => p.description);

  return {
    week_start: weekStartDate,
    last_week: {
      distance_miles: lastWeekSummary.total_distance_miles,
      run_count: lastWeekSummary.run_count,
      adherence_pct: lastWeekSummary.plan_adherence_pct,
      load_total: lastWeekSummary.training_load_total,
      intensity_distribution: lastWeekSummary.intensity_distribution,
    },
    rolling_4_weeks: {
      avg_weekly_miles: Math.round(avgWeeklyMiles * 10) / 10,
      avg_weekly_runs: Math.round(avgWeeklyRuns * 10) / 10,
      trend,
    },
    current_phase: currentBlock?.block_type ?? null,
    upcoming_race: nextRace ? {
      name: nextRace.name,
      date: nextRace.race_date,
      distance: formatDistance(nextRace.distance_meters),
      priority: nextRace.priority,
      weeks_out: weeksOut!,
    } : null,
    pace_zones: zones ? {
      easy: `${formatPace(zones.easy_pace_low ?? 0)}-${formatPace(zones.easy_pace_high ?? 0)}`,
      tempo: `${formatPace(zones.tempo_pace_low ?? 0)}-${formatPace(zones.tempo_pace_high ?? 0)}`,
      threshold: formatPace(zones.threshold_pace ?? 0),
      interval: formatPace(zones.interval_pace ?? 0),
    } : null,
    constraints: {
      overrides,
      injuries,
      life_events: lifeEvents,
    },
    active_patterns: activePatterns,
  };
}

/**
 * Format context pack as JSON for prompt injection
 */
export function formatContextPackForPrompt(pack: MorningContextPack | PostRunContextPack | WeeklyPlanningContextPack): string {
  return JSON.stringify(pack, null, 2);
}

// Helper functions

function formatPace(secondsPerMile: number): string {
  if (!secondsPerMile || secondsPerMile <= 0) return 'N/A';
  const minutes = Math.floor(secondsPerMile / 60);
  const seconds = Math.round(secondsPerMile % 60);
  return `${minutes}:${seconds.toString().padStart(2, '0')}/mi`;
}

function formatDistance(meters: number): string {
  const miles = meters / 1609.34;
  if (Math.abs(miles - 26.2) < 0.5) return 'Marathon';
  if (Math.abs(miles - 13.1) < 0.3) return 'Half Marathon';
  if (Math.abs(miles - 6.2) < 0.2) return '10K';
  if (Math.abs(miles - 3.1) < 0.1) return '5K';
  return `${Math.round(miles * 10) / 10} mi`;
}
