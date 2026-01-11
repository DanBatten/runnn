/**
 * Training Load Calculations - TRIMP and load metrics
 *
 * Calculates training load using multiple methods:
 * - TRIMP (Training Impulse) - duration × HR intensity
 * - Simple load (duration × RPE)
 * - Acute:Chronic workload ratio (ACWR)
 */

import { query, execute } from '../db/client.js';

interface WorkoutRow {
  id: string;
  local_date: string;
  duration_seconds: number | null;
  avg_hr: number | null;
  max_hr: number | null;
  perceived_exertion: number | null;
  training_load: number | null;
}


export interface DailyTrainingLoad {
  local_date: string;
  total_load: number;
  workout_count: number;
  workouts: Array<{
    id: string;
    load: number;
    method: 'trimp' | 'rpe' | 'garmin' | 'estimated';
  }>;
}

export interface LoadTrends {
  acute_load: number;   // Last 7 days average
  chronic_load: number; // Last 28 days average
  acwr: number;         // Acute:Chronic ratio
  weekly_total: number; // Current week total
  status: 'optimal' | 'building' | 'maintaining' | 'recovering' | 'overreaching';
}

// Athlete max HR - should be configurable via settings
const DEFAULT_MAX_HR = 190;
const DEFAULT_REST_HR = 50;

/**
 * Calculate TRIMP for a single workout
 * TRIMP = Duration (min) × ΔHR ratio × intensity weighting
 */
export function calculateTrimp(
  durationSeconds: number,
  avgHr: number,
  maxHr: number = DEFAULT_MAX_HR,
  restHr: number = DEFAULT_REST_HR,
  gender: 'male' | 'female' = 'male'
): number {
  const durationMinutes = durationSeconds / 60;
  const hrReserve = (avgHr - restHr) / (maxHr - restHr);

  // Clamp HR reserve to valid range
  const hrr = Math.max(0, Math.min(1, hrReserve));

  // Gender-specific exponential weighting (Banister formula)
  const y = gender === 'male' ? 1.92 : 1.67;

  // TRIMP = duration × HRR × exp(y × HRR)
  const trimp = durationMinutes * hrr * Math.exp(y * hrr);

  return Math.round(trimp);
}

/**
 * Calculate simple load from RPE
 * sRPE = Duration (min) × RPE
 */
export function calculateRpeLoad(
  durationSeconds: number,
  rpe: number
): number {
  const durationMinutes = durationSeconds / 60;
  return Math.round(durationMinutes * rpe);
}

/**
 * Calculate load for a workout using best available method
 */
export function calculateWorkoutLoad(workout: WorkoutRow): {
  load: number;
  method: 'trimp' | 'rpe' | 'garmin' | 'estimated';
} {
  // Prefer Garmin's training load if available
  if (workout.training_load && workout.training_load > 0) {
    return { load: workout.training_load, method: 'garmin' };
  }

  // Use TRIMP if we have HR data
  if (workout.duration_seconds && workout.avg_hr) {
    const trimp = calculateTrimp(
      workout.duration_seconds,
      workout.avg_hr,
      workout.max_hr ?? DEFAULT_MAX_HR
    );
    return { load: trimp, method: 'trimp' };
  }

  // Use RPE-based load if we have RPE
  if (workout.duration_seconds && workout.perceived_exertion) {
    const rpeLoad = calculateRpeLoad(
      workout.duration_seconds,
      workout.perceived_exertion
    );
    return { load: rpeLoad, method: 'rpe' };
  }

  // Estimate based on duration alone (assume moderate intensity)
  if (workout.duration_seconds) {
    const estimatedLoad = Math.round((workout.duration_seconds / 60) * 5);
    return { load: estimatedLoad, method: 'estimated' };
  }

  return { load: 0, method: 'estimated' };
}

/**
 * Get daily training load for a specific date
 */
export function getDailyLoad(targetDate: string): DailyTrainingLoad {
  const workouts = query<WorkoutRow>(
    `SELECT id, local_date, duration_seconds, avg_hr, max_hr,
            perceived_exertion, training_load
     FROM workouts
     WHERE local_date = ?`,
    [targetDate]
  );

  const workoutLoads = workouts.map(w => {
    const { load, method } = calculateWorkoutLoad(w);
    return { id: w.id, load, method };
  });

  const totalLoad = workoutLoads.reduce((sum, w) => sum + w.load, 0);

  return {
    local_date: targetDate,
    total_load: totalLoad,
    workout_count: workouts.length,
    workouts: workoutLoads,
  };
}

/**
 * Get load trends (acute, chronic, ACWR)
 */
export function getLoadTrends(targetDate: string): LoadTrends {
  // Get last 28 days of workouts
  const workouts = query<WorkoutRow>(
    `SELECT id, local_date, duration_seconds, avg_hr, max_hr,
            perceived_exertion, training_load
     FROM workouts
     WHERE local_date <= ? AND local_date > date(?, '-28 days')
     ORDER BY local_date DESC`,
    [targetDate, targetDate]
  );

  // Calculate daily loads
  const dailyLoads: Map<string, number> = new Map();
  for (const workout of workouts) {
    const { load } = calculateWorkoutLoad(workout);
    const current = dailyLoads.get(workout.local_date) || 0;
    dailyLoads.set(workout.local_date, current + load);
  }

  // Calculate acute (7-day) and chronic (28-day) loads
  let acuteTotal = 0;
  let chronicTotal = 0;
  let acuteDays = 0;
  let chronicDays = 0;

  const targetDateObj = new Date(targetDate);

  for (let i = 0; i < 28; i++) {
    const checkDate = new Date(targetDateObj);
    checkDate.setDate(checkDate.getDate() - i);
    const dateStr = checkDate.toISOString().split('T')[0];
    const dayLoad = dailyLoads.get(dateStr) || 0;

    chronicTotal += dayLoad;
    chronicDays++;

    if (i < 7) {
      acuteTotal += dayLoad;
      acuteDays++;
    }
  }

  const acuteLoad = acuteDays > 0 ? acuteTotal / acuteDays : 0;
  const chronicLoad = chronicDays > 0 ? chronicTotal / chronicDays : 0;
  const acwr = chronicLoad > 0 ? acuteLoad / chronicLoad : 1;

  // Get current week total
  const weekStart = getWeekStart(targetDate);
  const weekWorkouts = workouts.filter(w => w.local_date >= weekStart);
  const weeklyTotal = weekWorkouts.reduce((sum, w) => {
    const { load } = calculateWorkoutLoad(w);
    return sum + load;
  }, 0);

  // Determine status based on ACWR
  let status: LoadTrends['status'];
  if (acwr >= 0.8 && acwr <= 1.3) {
    status = 'optimal';
  } else if (acwr > 1.3 && acwr <= 1.5) {
    status = 'building';
  } else if (acwr > 1.5) {
    status = 'overreaching';
  } else if (acwr < 0.8 && acwr >= 0.6) {
    status = 'recovering';
  } else {
    status = 'maintaining';
  }

  return {
    acute_load: Math.round(acuteLoad),
    chronic_load: Math.round(chronicLoad),
    acwr: Math.round(acwr * 100) / 100,
    weekly_total: Math.round(weeklyTotal),
    status,
  };
}

/**
 * Store daily load in derived table
 */
export function storeDailyLoad(load: DailyTrainingLoad): void {
  execute(
    `INSERT OR REPLACE INTO daily_training_load
     (local_date, total_load, workout_count, computed_at)
     VALUES (?, ?, ?, ?)`,
    [load.local_date, load.total_load, load.workout_count, new Date().toISOString()]
  );
}

/**
 * Compute and store daily loads for a date range
 */
export function computeLoadsForRange(startDate: string, endDate: string): number {
  let count = 0;
  let currentDate = new Date(startDate);
  const end = new Date(endDate);

  while (currentDate <= end) {
    const dateStr = currentDate.toISOString().split('T')[0];
    const load = getDailyLoad(dateStr);

    if (load.workout_count > 0) {
      storeDailyLoad(load);
      count++;
    }

    currentDate.setDate(currentDate.getDate() + 1);
  }

  return count;
}

/**
 * Format load trends for display
 */
export function formatLoadTrends(targetDate: string): string {
  const trends = getLoadTrends(targetDate);
  const daily = getDailyLoad(targetDate);

  const lines: string[] = [
    `Training Load Status: ${trends.status.toUpperCase()}`,
    '',
    `  Today: ${daily.total_load} (${daily.workout_count} workout${daily.workout_count !== 1 ? 's' : ''})`,
    `  This week: ${trends.weekly_total}`,
    '',
    `  Acute (7-day avg): ${trends.acute_load}`,
    `  Chronic (28-day avg): ${trends.chronic_load}`,
    `  ACWR: ${trends.acwr.toFixed(2)}`,
    '',
  ];

  // Add interpretation
  if (trends.acwr > 1.5) {
    lines.push('  ⚠️  High acute:chronic ratio - consider reducing volume');
  } else if (trends.acwr >= 1.3) {
    lines.push('  📈 Building load - monitor fatigue closely');
  } else if (trends.acwr >= 0.8) {
    lines.push('  ✓  Load in optimal training zone');
  } else if (trends.acwr >= 0.6) {
    lines.push('  📉 Recovering/maintaining - good for adaptation');
  } else {
    lines.push('  ⚠️  Low training stimulus - may lose fitness');
  }

  return lines.join('\n');
}

/**
 * Get week start (Monday) for a date
 */
function getWeekStart(dateStr: string): string {
  const date = new Date(dateStr);
  const day = date.getDay();
  const diff = date.getDate() - day + (day === 0 ? -6 : 1);
  const monday = new Date(date.setDate(diff));
  return monday.toISOString().split('T')[0];
}
