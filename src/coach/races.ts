/**
 * Races - Manage goal races and results
 *
 * Races are the long-horizon planning anchor:
 * - A priority: main goal race
 * - B priority: tune-up races
 * - C priority: fun races, not training-focused
 */

import { query, queryOne, generateId, insertWithEvent, updateWithEvent, deleteWithEvent } from '../db/client.js';

export type RacePriority = 'A' | 'B' | 'C';
export type CourseProfile = 'flat' | 'rolling' | 'hilly' | 'mountainous';

export interface Race {
  id: string;
  name: string;
  distance_meters: number;
  race_date: string;
  priority: RacePriority;
  course_profile: CourseProfile | null;
  expected_temp_f: number | null;
  expected_humidity_pct: number | null;
  goal_time_seconds: number | null;
  result_time_seconds: number | null;
  result_notes: string | null;
  training_plan_id: string | null;
}

interface RaceRow {
  id: string;
  name: string;
  distance_meters: number;
  race_date: string;
  priority: string;
  course_profile: string | null;
  expected_temp_f: number | null;
  expected_humidity_pct: number | null;
  goal_time_seconds: number | null;
  result_time_seconds: number | null;
  result_notes: string | null;
  training_plan_id: string | null;
}

/**
 * Create a new race
 */
export function createRace(race: {
  name: string;
  distance_meters: number;
  race_date: string;
  priority: RacePriority;
  course_profile?: CourseProfile;
  expected_temp_f?: number;
  expected_humidity_pct?: number;
  goal_time_seconds?: number;
  training_plan_id?: string;
}): string {
  const id = generateId();

  insertWithEvent(
    'races',
    {
      id,
      name: race.name,
      distance_meters: race.distance_meters,
      race_date: race.race_date,
      priority: race.priority,
      course_profile: race.course_profile ?? null,
      expected_temp_f: race.expected_temp_f ?? null,
      expected_humidity_pct: race.expected_humidity_pct ?? null,
      goal_time_seconds: race.goal_time_seconds ?? null,
      result_time_seconds: null,
      result_notes: null,
      training_plan_id: race.training_plan_id ?? null,
    },
    { source: 'race_create' }
  );

  return id;
}

/**
 * Get race by ID
 */
export function getRaceById(id: string): Race | null {
  const row = queryOne<RaceRow>(
    'SELECT * FROM races WHERE id = ?',
    [id]
  );

  return row ? parseRaceRow(row) : null;
}

/**
 * Get all upcoming races
 */
export function getUpcomingRaces(): Race[] {
  const today = new Date().toISOString().split('T')[0];
  const rows = query<RaceRow>(
    'SELECT * FROM races WHERE race_date >= ? ORDER BY race_date ASC',
    [today]
  );

  return rows.map(parseRaceRow);
}

/**
 * Get past races
 */
export function getPastRaces(limit: number = 10): Race[] {
  const today = new Date().toISOString().split('T')[0];
  const rows = query<RaceRow>(
    'SELECT * FROM races WHERE race_date < ? ORDER BY race_date DESC LIMIT ?',
    [today, limit]
  );

  return rows.map(parseRaceRow);
}

/**
 * Get races by priority
 */
export function getRacesByPriority(priority: RacePriority): Race[] {
  const rows = query<RaceRow>(
    'SELECT * FROM races WHERE priority = ? ORDER BY race_date ASC',
    [priority]
  );

  return rows.map(parseRaceRow);
}

/**
 * Get the next A-priority race (main goal)
 */
export function getGoalRace(): Race | null {
  const today = new Date().toISOString().split('T')[0];
  const row = queryOne<RaceRow>(
    `SELECT * FROM races
     WHERE priority = 'A' AND race_date >= ?
     ORDER BY race_date ASC LIMIT 1`,
    [today]
  );

  return row ? parseRaceRow(row) : null;
}

/**
 * Update race details
 */
export function updateRace(id: string, updates: Partial<Omit<Race, 'id'>>): void {
  const updateData: Record<string, unknown> = {};

  if (updates.name !== undefined) updateData.name = updates.name;
  if (updates.distance_meters !== undefined) updateData.distance_meters = updates.distance_meters;
  if (updates.race_date !== undefined) updateData.race_date = updates.race_date;
  if (updates.priority !== undefined) updateData.priority = updates.priority;
  if (updates.course_profile !== undefined) updateData.course_profile = updates.course_profile;
  if (updates.expected_temp_f !== undefined) updateData.expected_temp_f = updates.expected_temp_f;
  if (updates.expected_humidity_pct !== undefined) updateData.expected_humidity_pct = updates.expected_humidity_pct;
  if (updates.goal_time_seconds !== undefined) updateData.goal_time_seconds = updates.goal_time_seconds;
  if (updates.training_plan_id !== undefined) updateData.training_plan_id = updates.training_plan_id;

  if (Object.keys(updateData).length > 0) {
    updateWithEvent('races', id, updateData, { source: 'race_update' });
  }
}

/**
 * Record race result
 */
export function recordRaceResult(
  id: string,
  result_time_seconds: number,
  notes?: string
): void {
  updateWithEvent(
    'races',
    id,
    {
      result_time_seconds,
      result_notes: notes ?? null,
    },
    { source: 'race_result' }
  );
}

/**
 * Delete a race
 */
export function deleteRace(id: string): void {
  deleteWithEvent('races', id, { source: 'race_delete' });
}

/**
 * Calculate days until race
 */
export function daysUntilRace(race: Race): number {
  const today = new Date();
  const raceDate = new Date(race.race_date);
  const diffTime = raceDate.getTime() - today.getTime();
  return Math.ceil(diffTime / (1000 * 60 * 60 * 24));
}

/**
 * Calculate goal pace from goal time
 */
export function calculateGoalPace(race: Race): number | null {
  if (!race.goal_time_seconds) return null;
  const miles = race.distance_meters / 1609.344;
  return race.goal_time_seconds / miles;
}

/**
 * Format race for display
 */
export function formatRace(race: Race): string {
  const distanceMiles = (race.distance_meters / 1609.344).toFixed(1);
  const daysLeft = daysUntilRace(race);

  let str = `${race.name} (${distanceMiles}mi) - ${race.race_date}`;

  if (daysLeft > 0) {
    str += ` (${daysLeft} days)`;
  }

  if (race.goal_time_seconds) {
    str += ` | Goal: ${formatTime(race.goal_time_seconds)}`;
  }

  if (race.result_time_seconds) {
    str += ` | Result: ${formatTime(race.result_time_seconds)}`;
  }

  return str;
}

/**
 * Format seconds as HH:MM:SS or MM:SS
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
 * Parse a database row into Race
 */
function parseRaceRow(row: RaceRow): Race {
  return {
    id: row.id,
    name: row.name,
    distance_meters: row.distance_meters,
    race_date: row.race_date,
    priority: row.priority as RacePriority,
    course_profile: row.course_profile as CourseProfile | null,
    expected_temp_f: row.expected_temp_f,
    expected_humidity_pct: row.expected_humidity_pct,
    goal_time_seconds: row.goal_time_seconds,
    result_time_seconds: row.result_time_seconds,
    result_notes: row.result_notes,
    training_plan_id: row.training_plan_id,
  };
}
