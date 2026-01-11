/**
 * Fitness Tests - Track time trials and threshold tests
 *
 * Fitness tests provide:
 * - Current fitness benchmarks
 * - Input data for pace zone calculations
 * - Progress tracking over time
 */

import { query, queryOne, generateId, insertWithEvent, updateWithEvent, deleteWithEvent } from '../db/client.js';

export type TestType = 'time_trial' | 'threshold_test' | 'vo2max' | 'lactate' | 'race_result';

export interface FitnessTest {
  id: string;
  test_type: TestType;
  distance_meters: number | null;
  local_date: string;
  result_time_seconds: number | null;
  result_pace_sec_per_mile: number | null;
  result_hr_avg: number | null;
  result_hr_threshold: number | null;
  notes: string | null;
  workout_id: string | null;
}

interface FitnessTestRow {
  id: string;
  test_type: string;
  distance_meters: number | null;
  local_date: string;
  result_time_seconds: number | null;
  result_pace_sec_per_mile: number | null;
  result_hr_avg: number | null;
  result_hr_threshold: number | null;
  notes: string | null;
  workout_id: string | null;
}

/**
 * Create a new fitness test
 */
export function createFitnessTest(test: {
  test_type: TestType;
  local_date: string;
  distance_meters?: number;
  result_time_seconds?: number;
  result_pace_sec_per_mile?: number;
  result_hr_avg?: number;
  result_hr_threshold?: number;
  notes?: string;
  workout_id?: string;
}): string {
  const id = generateId();

  // Calculate pace if time and distance provided
  let pace = test.result_pace_sec_per_mile;
  if (!pace && test.result_time_seconds && test.distance_meters) {
    const miles = test.distance_meters / 1609.344;
    pace = test.result_time_seconds / miles;
  }

  insertWithEvent(
    'fitness_tests',
    {
      id,
      test_type: test.test_type,
      distance_meters: test.distance_meters ?? null,
      local_date: test.local_date,
      result_time_seconds: test.result_time_seconds ?? null,
      result_pace_sec_per_mile: pace ?? null,
      result_hr_avg: test.result_hr_avg ?? null,
      result_hr_threshold: test.result_hr_threshold ?? null,
      notes: test.notes ?? null,
      workout_id: test.workout_id ?? null,
    },
    { source: 'fitness_test_create' }
  );

  return id;
}

/**
 * Get fitness test by ID
 */
export function getFitnessTestById(id: string): FitnessTest | null {
  const row = queryOne<FitnessTestRow>(
    'SELECT * FROM fitness_tests WHERE id = ?',
    [id]
  );

  return row ? parseFitnessTestRow(row) : null;
}

/**
 * Get all fitness tests, most recent first
 */
export function getAllFitnessTests(limit: number = 20): FitnessTest[] {
  const rows = query<FitnessTestRow>(
    'SELECT * FROM fitness_tests ORDER BY local_date DESC LIMIT ?',
    [limit]
  );

  return rows.map(parseFitnessTestRow);
}

/**
 * Get fitness tests by type
 */
export function getFitnessTestsByType(testType: TestType): FitnessTest[] {
  const rows = query<FitnessTestRow>(
    'SELECT * FROM fitness_tests WHERE test_type = ? ORDER BY local_date DESC',
    [testType]
  );

  return rows.map(parseFitnessTestRow);
}

/**
 * Get most recent fitness test of a type
 */
export function getMostRecentTest(testType: TestType): FitnessTest | null {
  const row = queryOne<FitnessTestRow>(
    'SELECT * FROM fitness_tests WHERE test_type = ? ORDER BY local_date DESC LIMIT 1',
    [testType]
  );

  return row ? parseFitnessTestRow(row) : null;
}

/**
 * Get fitness tests for a specific distance (e.g., all 5K tests)
 */
export function getTestsByDistance(distanceMeters: number, tolerance: number = 100): FitnessTest[] {
  const rows = query<FitnessTestRow>(
    `SELECT * FROM fitness_tests
     WHERE distance_meters BETWEEN ? AND ?
     ORDER BY local_date DESC`,
    [distanceMeters - tolerance, distanceMeters + tolerance]
  );

  return rows.map(parseFitnessTestRow);
}

/**
 * Get the most recent test that can be used for pace calculations
 * Prioritizes: threshold_test > time_trial > race_result
 */
export function getBestRecentTest(): FitnessTest | null {
  // Try threshold test first (most accurate for zones)
  let test = getMostRecentTest('threshold_test');
  if (test) return test;

  // Fall back to time trial
  test = getMostRecentTest('time_trial');
  if (test) return test;

  // Fall back to recent race
  test = getMostRecentTest('race_result');
  return test;
}

/**
 * Update fitness test
 */
export function updateFitnessTest(id: string, updates: Partial<Omit<FitnessTest, 'id'>>): void {
  const updateData: Record<string, unknown> = {};

  if (updates.test_type !== undefined) updateData.test_type = updates.test_type;
  if (updates.distance_meters !== undefined) updateData.distance_meters = updates.distance_meters;
  if (updates.local_date !== undefined) updateData.local_date = updates.local_date;
  if (updates.result_time_seconds !== undefined) updateData.result_time_seconds = updates.result_time_seconds;
  if (updates.result_pace_sec_per_mile !== undefined) updateData.result_pace_sec_per_mile = updates.result_pace_sec_per_mile;
  if (updates.result_hr_avg !== undefined) updateData.result_hr_avg = updates.result_hr_avg;
  if (updates.result_hr_threshold !== undefined) updateData.result_hr_threshold = updates.result_hr_threshold;
  if (updates.notes !== undefined) updateData.notes = updates.notes;
  if (updates.workout_id !== undefined) updateData.workout_id = updates.workout_id;

  if (Object.keys(updateData).length > 0) {
    updateWithEvent('fitness_tests', id, updateData, { source: 'fitness_test_update' });
  }
}

/**
 * Delete fitness test
 */
export function deleteFitnessTest(id: string): void {
  deleteWithEvent('fitness_tests', id, { source: 'fitness_test_delete' });
}

/**
 * Link fitness test to a workout
 */
export function linkTestToWorkout(testId: string, workoutId: string): void {
  updateWithEvent(
    'fitness_tests',
    testId,
    { workout_id: workoutId },
    { source: 'fitness_test_link' }
  );
}

/**
 * Calculate VDOT from a race/test result
 * Simplified VDOT estimation based on Jack Daniels' formula
 */
export function estimateVDOT(distanceMeters: number, timeSeconds: number): number {
  // This is a simplified approximation
  // Full VDOT calculation is more complex
  const distanceKm = distanceMeters / 1000;
  const timeMinutes = timeSeconds / 60;
  const velocity = distanceKm / timeMinutes; // km/min

  // Simplified VO2 estimation
  const vo2 = -4.6 + 0.182258 * velocity * 1000 + 0.000104 * Math.pow(velocity * 1000, 2);

  // Simplified percent max estimation based on time
  const percentMax = 0.8 + 0.1894393 * Math.exp(-0.012778 * timeMinutes) +
    0.2989558 * Math.exp(-0.1932605 * timeMinutes);

  return vo2 / percentMax;
}

/**
 * Format fitness test for display
 */
export function formatFitnessTest(test: FitnessTest): string {
  const parts: string[] = [`${test.test_type} - ${test.local_date}`];

  if (test.distance_meters) {
    const miles = (test.distance_meters / 1609.344).toFixed(2);
    parts.push(`${miles}mi`);
  }

  if (test.result_time_seconds) {
    parts.push(formatTime(test.result_time_seconds));
  }

  if (test.result_pace_sec_per_mile) {
    parts.push(`${formatPace(test.result_pace_sec_per_mile)}/mi`);
  }

  if (test.result_hr_avg) {
    parts.push(`HR: ${test.result_hr_avg}`);
  }

  return parts.join(' | ');
}

/**
 * Format seconds as MM:SS
 */
function formatTime(seconds: number): string {
  const hours = Math.floor(seconds / 3600);
  const mins = Math.floor((seconds % 3600) / 60);
  const secs = Math.floor(seconds % 60);

  if (hours > 0) {
    return `${hours}:${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  }
  return `${mins}:${secs.toString().padStart(2, '0')}`;
}

/**
 * Format pace as MM:SS
 */
function formatPace(secPerMile: number): string {
  const mins = Math.floor(secPerMile / 60);
  const secs = Math.floor(secPerMile % 60);
  return `${mins}:${secs.toString().padStart(2, '0')}`;
}

/**
 * Parse a database row into FitnessTest
 */
function parseFitnessTestRow(row: FitnessTestRow): FitnessTest {
  return {
    id: row.id,
    test_type: row.test_type as TestType,
    distance_meters: row.distance_meters,
    local_date: row.local_date,
    result_time_seconds: row.result_time_seconds,
    result_pace_sec_per_mile: row.result_pace_sec_per_mile,
    result_hr_avg: row.result_hr_avg,
    result_hr_threshold: row.result_hr_threshold,
    notes: row.notes,
    workout_id: row.workout_id,
  };
}
