/**
 * Weekly Summaries - Aggregate training metrics by week
 *
 * Computed metrics:
 * - Total distance and duration
 * - Run count and intensity distribution
 * - Plan adherence percentage
 * - Average execution score
 */

import { query, queryOne, execute } from '../db/client.js';

interface WorkoutRow {
  id: string;
  local_date: string;
  type: string | null;
  distance_meters: number | null;
  duration_seconds: number | null;
  training_load: number | null;
  execution_score: number | null;
}

interface PlannedWorkoutRow {
  id: string;
  local_date: string;
  status: string;
}

interface WeeklySummaryRow {
  week_start_date: string;
  total_distance_meters: number | null;
  total_duration_seconds: number | null;
  run_count: number;
  intensity_distribution: string | null;
  plan_adherence_pct: number | null;
  avg_execution_score: number | null;
  training_load_total: number | null;
  notes: string | null;
  computed_at: string;
}

export interface IntensityDistribution {
  easy: number;
  steady: number;
  tempo: number;
  threshold: number;
  interval: number;
  long: number;
  race: number;
  other: number;
}

export interface WeeklySummary {
  week_start_date: string;
  week_end_date: string;
  total_distance_meters: number;
  total_distance_miles: number;
  total_duration_seconds: number;
  total_duration_hours: number;
  run_count: number;
  intensity_distribution: IntensityDistribution;
  plan_adherence_pct: number;
  avg_execution_score: number | null;
  training_load_total: number;
  computed_at: string;
}

/**
 * Get week start (Monday) and end (Sunday) for a date
 */
export function getWeekBounds(dateStr: string): { start: string; end: string } {
  const date = new Date(dateStr);
  const day = date.getDay();
  const diff = date.getDate() - day + (day === 0 ? -6 : 1);

  const monday = new Date(date);
  monday.setDate(diff);

  const sunday = new Date(monday);
  sunday.setDate(monday.getDate() + 6);

  return {
    start: monday.toISOString().split('T')[0],
    end: sunday.toISOString().split('T')[0],
  };
}

/**
 * Compute weekly summary for a week containing the given date
 */
export function computeWeeklySummary(dateInWeek: string): WeeklySummary {
  const { start, end } = getWeekBounds(dateInWeek);

  // Get all workouts in the week
  const workouts = query<WorkoutRow>(
    `SELECT id, local_date, type, distance_meters, duration_seconds,
            training_load, execution_score
     FROM workouts
     WHERE local_date >= ? AND local_date <= ?`,
    [start, end]
  );

  // Calculate totals
  const totalDistance = workouts.reduce((sum, w) => sum + (w.distance_meters || 0), 0);
  const totalDuration = workouts.reduce((sum, w) => sum + (w.duration_seconds || 0), 0);
  const totalLoad = workouts.reduce((sum, w) => sum + (w.training_load || 0), 0);

  // Calculate intensity distribution
  const distribution: IntensityDistribution = {
    easy: 0, steady: 0, tempo: 0, threshold: 0,
    interval: 0, long: 0, race: 0, other: 0,
  };

  for (const workout of workouts) {
    const type = (workout.type || 'other').toLowerCase();
    const distance = workout.distance_meters || 0;

    if (type in distribution) {
      distribution[type as keyof IntensityDistribution] += distance;
    } else {
      distribution.other += distance;
    }
  }

  // Convert to percentages
  if (totalDistance > 0) {
    for (const key of Object.keys(distribution) as (keyof IntensityDistribution)[]) {
      distribution[key] = Math.round((distribution[key] / totalDistance) * 100);
    }
  }

  // Calculate plan adherence
  const plannedWorkouts = query<PlannedWorkoutRow>(
    `SELECT id, local_date, status
     FROM planned_workouts
     WHERE local_date >= ? AND local_date <= ?`,
    [start, end]
  );

  const plannedCount = plannedWorkouts.length;
  const completedCount = plannedWorkouts.filter(p => p.status === 'completed').length;
  const adherence = plannedCount > 0 ? (completedCount / plannedCount) * 100 : 100;

  // Calculate average execution score
  const scores = workouts
    .filter(w => w.execution_score !== null)
    .map(w => w.execution_score!);
  const avgScore = scores.length > 0
    ? scores.reduce((sum, s) => sum + s, 0) / scores.length
    : null;

  return {
    week_start_date: start,
    week_end_date: end,
    total_distance_meters: Math.round(totalDistance),
    total_distance_miles: Math.round(totalDistance / 1609.34 * 10) / 10,
    total_duration_seconds: Math.round(totalDuration),
    total_duration_hours: Math.round(totalDuration / 3600 * 10) / 10,
    run_count: workouts.length,
    intensity_distribution: distribution,
    plan_adherence_pct: Math.round(adherence),
    avg_execution_score: avgScore !== null ? Math.round(avgScore) : null,
    training_load_total: Math.round(totalLoad),
    computed_at: new Date().toISOString(),
  };
}

/**
 * Store weekly summary in database
 */
export function storeWeeklySummary(summary: WeeklySummary): void {
  execute(
    `INSERT OR REPLACE INTO weekly_summaries
     (week_start_date, total_distance_meters, total_duration_seconds,
      run_count, intensity_distribution, plan_adherence_pct,
      avg_execution_score, training_load_total, computed_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      summary.week_start_date,
      summary.total_distance_meters,
      summary.total_duration_seconds,
      summary.run_count,
      JSON.stringify(summary.intensity_distribution),
      summary.plan_adherence_pct,
      summary.avg_execution_score,
      summary.training_load_total,
      summary.computed_at,
    ]
  );
}

/**
 * Get stored weekly summary
 */
export function getWeeklySummary(weekStartDate: string): WeeklySummary | null {
  const row = queryOne<WeeklySummaryRow>(
    'SELECT * FROM weekly_summaries WHERE week_start_date = ?',
    [weekStartDate]
  );

  if (!row) return null;

  const { end } = getWeekBounds(weekStartDate);

  return {
    week_start_date: row.week_start_date,
    week_end_date: end,
    total_distance_meters: row.total_distance_meters || 0,
    total_distance_miles: Math.round((row.total_distance_meters || 0) / 1609.34 * 10) / 10,
    total_duration_seconds: row.total_duration_seconds || 0,
    total_duration_hours: Math.round((row.total_duration_seconds || 0) / 3600 * 10) / 10,
    run_count: row.run_count,
    intensity_distribution: row.intensity_distribution
      ? JSON.parse(row.intensity_distribution)
      : { easy: 0, steady: 0, tempo: 0, threshold: 0, interval: 0, long: 0, race: 0, other: 0 },
    plan_adherence_pct: row.plan_adherence_pct || 0,
    avg_execution_score: row.avg_execution_score,
    training_load_total: row.training_load_total || 0,
    computed_at: row.computed_at,
  };
}

/**
 * Get recent weekly summaries
 */
export function getRecentWeeklySummaries(count: number = 4): WeeklySummary[] {
  const rows = query<WeeklySummaryRow>(
    `SELECT * FROM weekly_summaries
     ORDER BY week_start_date DESC
     LIMIT ?`,
    [count]
  );

  return rows.map(row => {
    const { end } = getWeekBounds(row.week_start_date);
    return {
      week_start_date: row.week_start_date,
      week_end_date: end,
      total_distance_meters: row.total_distance_meters || 0,
      total_distance_miles: Math.round((row.total_distance_meters || 0) / 1609.34 * 10) / 10,
      total_duration_seconds: row.total_duration_seconds || 0,
      total_duration_hours: Math.round((row.total_duration_seconds || 0) / 3600 * 10) / 10,
      run_count: row.run_count,
      intensity_distribution: row.intensity_distribution
        ? JSON.parse(row.intensity_distribution)
        : { easy: 0, steady: 0, tempo: 0, threshold: 0, interval: 0, long: 0, race: 0, other: 0 },
      plan_adherence_pct: row.plan_adherence_pct || 0,
      avg_execution_score: row.avg_execution_score,
      training_load_total: row.training_load_total || 0,
      computed_at: row.computed_at,
    };
  });
}

/**
 * Compute and store summaries for all weeks with data
 */
export function backfillWeeklySummaries(): number {
  const dateRange = queryOne<{ min_date: string; max_date: string }>(
    `SELECT MIN(local_date) as min_date, MAX(local_date) as max_date
     FROM workouts`
  );

  if (!dateRange || !dateRange.min_date || !dateRange.max_date) {
    return 0;
  }

  let count = 0;
  let currentWeekStart = getWeekBounds(dateRange.min_date).start;
  const maxWeekStart = getWeekBounds(dateRange.max_date).start;

  while (currentWeekStart <= maxWeekStart) {
    const summary = computeWeeklySummary(currentWeekStart);
    if (summary.run_count > 0) {
      storeWeeklySummary(summary);
      count++;
    }

    // Move to next week
    const nextWeek = new Date(currentWeekStart);
    nextWeek.setDate(nextWeek.getDate() + 7);
    currentWeekStart = nextWeek.toISOString().split('T')[0];
  }

  return count;
}

/**
 * Format weekly summary for display
 */
export function formatWeeklySummary(summary: WeeklySummary): string {
  const lines: string[] = [
    `Week of ${summary.week_start_date} to ${summary.week_end_date}`,
    '',
    `  Distance: ${summary.total_distance_miles} miles`,
    `  Duration: ${summary.total_duration_hours} hours`,
    `  Runs: ${summary.run_count}`,
    `  Training Load: ${summary.training_load_total}`,
    '',
    `  Plan Adherence: ${summary.plan_adherence_pct}%`,
  ];

  if (summary.avg_execution_score !== null) {
    lines.push(`  Avg Execution Score: ${summary.avg_execution_score}`);
  }

  lines.push('');
  lines.push('  Intensity Distribution:');

  const dist = summary.intensity_distribution;
  if (dist.easy > 0) lines.push(`    Easy: ${dist.easy}%`);
  if (dist.steady > 0) lines.push(`    Steady: ${dist.steady}%`);
  if (dist.tempo > 0) lines.push(`    Tempo: ${dist.tempo}%`);
  if (dist.threshold > 0) lines.push(`    Threshold: ${dist.threshold}%`);
  if (dist.interval > 0) lines.push(`    Interval: ${dist.interval}%`);
  if (dist.long > 0) lines.push(`    Long: ${dist.long}%`);
  if (dist.race > 0) lines.push(`    Race: ${dist.race}%`);
  if (dist.other > 0) lines.push(`    Other: ${dist.other}%`);

  return lines.join('\n');
}

/**
 * Compare two weeks
 */
export function compareWeeks(week1Start: string, week2Start: string): {
  distance_change_pct: number;
  duration_change_pct: number;
  load_change_pct: number;
  run_count_diff: number;
} {
  const summary1 = computeWeeklySummary(week1Start);
  const summary2 = computeWeeklySummary(week2Start);

  const distanceChange = summary1.total_distance_meters > 0
    ? ((summary2.total_distance_meters - summary1.total_distance_meters) / summary1.total_distance_meters) * 100
    : 0;

  const durationChange = summary1.total_duration_seconds > 0
    ? ((summary2.total_duration_seconds - summary1.total_duration_seconds) / summary1.total_duration_seconds) * 100
    : 0;

  const loadChange = summary1.training_load_total > 0
    ? ((summary2.training_load_total - summary1.training_load_total) / summary1.training_load_total) * 100
    : 0;

  return {
    distance_change_pct: Math.round(distanceChange),
    duration_change_pct: Math.round(durationChange),
    load_change_pct: Math.round(loadChange),
    run_count_diff: summary2.run_count - summary1.run_count,
  };
}
