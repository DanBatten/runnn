/**
 * Life Context - Track life events, strength sessions, and injuries
 *
 * High-leverage context that explains "bad run ≠ bad fitness":
 * - Life events (travel, illness, stress)
 * - Strength sessions
 * - Injury status
 */

import { query, queryOne, generateId, insertWithEvent, updateWithEvent, deleteWithEvent } from '../db/client.js';

// ===========================================
// LIFE EVENTS
// ===========================================

export type LifeEventType = 'travel' | 'illness' | 'stress' | 'sleep_disruption' | 'family' | 'work' | 'other';

export interface LifeEvent {
  id: string;
  local_date: string;
  event_type: LifeEventType;
  severity: number | null;
  duration_days: number | null;
  timezone_change_hours: number | null;
  notes: string | null;
}

interface LifeEventRow {
  id: string;
  local_date: string;
  event_type: string;
  severity: number | null;
  duration_days: number | null;
  timezone_change_hours: number | null;
  notes: string | null;
}

/**
 * Create a life event
 */
export function createLifeEvent(event: {
  local_date: string;
  event_type: LifeEventType;
  severity?: number;
  duration_days?: number;
  timezone_change_hours?: number;
  notes?: string;
}): string {
  const id = generateId();

  insertWithEvent(
    'life_events',
    {
      id,
      local_date: event.local_date,
      event_type: event.event_type,
      severity: event.severity ?? null,
      duration_days: event.duration_days ?? null,
      timezone_change_hours: event.timezone_change_hours ?? null,
      notes: event.notes ?? null,
    },
    { source: 'life_event_create' }
  );

  return id;
}

/**
 * Get life event by ID
 */
export function getLifeEventById(id: string): LifeEvent | null {
  const row = queryOne<LifeEventRow>(
    'SELECT * FROM life_events WHERE id = ?',
    [id]
  );

  return row ? parseLifeEventRow(row) : null;
}

/**
 * Get recent life events
 */
export function getRecentLifeEvents(daysBack: number = 7): LifeEvent[] {
  const cutoff = subtractDays(new Date().toISOString().split('T')[0], daysBack);
  const rows = query<LifeEventRow>(
    'SELECT * FROM life_events WHERE local_date >= ? ORDER BY local_date DESC',
    [cutoff]
  );

  return rows.map(parseLifeEventRow);
}

/**
 * Get life events by type
 */
export function getLifeEventsByType(eventType: LifeEventType): LifeEvent[] {
  const rows = query<LifeEventRow>(
    'SELECT * FROM life_events WHERE event_type = ? ORDER BY local_date DESC',
    [eventType]
  );

  return rows.map(parseLifeEventRow);
}

/**
 * Get most recent travel event
 */
export function getMostRecentTravel(): LifeEvent | null {
  const row = queryOne<LifeEventRow>(
    `SELECT * FROM life_events
     WHERE event_type = 'travel'
     ORDER BY local_date DESC LIMIT 1`
  );

  return row ? parseLifeEventRow(row) : null;
}

/**
 * Delete life event
 */
export function deleteLifeEvent(id: string): void {
  deleteWithEvent('life_events', id, { source: 'life_event_delete' });
}

function parseLifeEventRow(row: LifeEventRow): LifeEvent {
  return {
    id: row.id,
    local_date: row.local_date,
    event_type: row.event_type as LifeEventType,
    severity: row.severity,
    duration_days: row.duration_days,
    timezone_change_hours: row.timezone_change_hours,
    notes: row.notes,
  };
}

// ===========================================
// STRENGTH SESSIONS
// ===========================================

export type StrengthSessionType = 'gym' | 'home' | 'yoga' | 'mobility' | 'cross_training';

export interface StrengthSession {
  id: string;
  local_date: string;
  session_type: StrengthSessionType | null;
  duration_minutes: number | null;
  perceived_exertion: number | null;
  soreness_next_day: number | null;
  focus_areas: string[];
  notes: string | null;
}

interface StrengthSessionRow {
  id: string;
  local_date: string;
  session_type: string | null;
  duration_minutes: number | null;
  perceived_exertion: number | null;
  soreness_next_day: number | null;
  focus_areas: string | null;
  notes: string | null;
}

/**
 * Create a strength session
 */
export function createStrengthSession(session: {
  local_date: string;
  session_type?: StrengthSessionType;
  duration_minutes?: number;
  perceived_exertion?: number;
  focus_areas?: string[];
  notes?: string;
}): string {
  const id = generateId();

  insertWithEvent(
    'strength_sessions',
    {
      id,
      local_date: session.local_date,
      session_type: session.session_type ?? null,
      duration_minutes: session.duration_minutes ?? null,
      perceived_exertion: session.perceived_exertion ?? null,
      soreness_next_day: null,
      focus_areas: session.focus_areas ? JSON.stringify(session.focus_areas) : null,
      notes: session.notes ?? null,
    },
    { source: 'strength_session_create' }
  );

  return id;
}

/**
 * Get strength session by ID
 */
export function getStrengthSessionById(id: string): StrengthSession | null {
  const row = queryOne<StrengthSessionRow>(
    'SELECT * FROM strength_sessions WHERE id = ?',
    [id]
  );

  return row ? parseStrengthSessionRow(row) : null;
}

/**
 * Get recent strength sessions
 */
export function getRecentStrengthSessions(daysBack: number = 14): StrengthSession[] {
  const cutoff = subtractDays(new Date().toISOString().split('T')[0], daysBack);
  const rows = query<StrengthSessionRow>(
    'SELECT * FROM strength_sessions WHERE local_date >= ? ORDER BY local_date DESC',
    [cutoff]
  );

  return rows.map(parseStrengthSessionRow);
}

/**
 * Get strength session from yesterday (for leg consideration)
 */
export function getYesterdayStrengthSession(): StrengthSession | null {
  const yesterday = subtractDays(new Date().toISOString().split('T')[0], 1);
  const row = queryOne<StrengthSessionRow>(
    'SELECT * FROM strength_sessions WHERE local_date = ?',
    [yesterday]
  );

  return row ? parseStrengthSessionRow(row) : null;
}

/**
 * Record soreness from strength session
 */
export function recordSoreness(sessionId: string, sorenessLevel: number): void {
  updateWithEvent(
    'strength_sessions',
    sessionId,
    { soreness_next_day: Math.max(1, Math.min(10, sorenessLevel)) },
    { source: 'strength_soreness_record' }
  );
}

/**
 * Delete strength session
 */
export function deleteStrengthSession(id: string): void {
  deleteWithEvent('strength_sessions', id, { source: 'strength_session_delete' });
}

function parseStrengthSessionRow(row: StrengthSessionRow): StrengthSession {
  return {
    id: row.id,
    local_date: row.local_date,
    session_type: row.session_type as StrengthSessionType | null,
    duration_minutes: row.duration_minutes,
    perceived_exertion: row.perceived_exertion,
    soreness_next_day: row.soreness_next_day,
    focus_areas: row.focus_areas ? JSON.parse(row.focus_areas) : [],
    notes: row.notes,
  };
}

// ===========================================
// INJURY STATUS
// ===========================================

export type InjuryTrend = 'improving' | 'stable' | 'worsening';

export interface InjuryStatus {
  id: string;
  local_date: string;
  location: string;
  severity: number;
  trend: InjuryTrend | null;
  limits_running: boolean;
  notes: string | null;
}

interface InjuryStatusRow {
  id: string;
  local_date: string;
  location: string;
  severity: number;
  trend: string | null;
  limits_running: number;
  notes: string | null;
}

/**
 * Log an injury status update
 */
export function logInjuryStatus(injury: {
  local_date: string;
  location: string;
  severity: number;
  trend?: InjuryTrend;
  limits_running?: boolean;
  notes?: string;
}): string {
  const id = generateId();

  insertWithEvent(
    'injury_status',
    {
      id,
      local_date: injury.local_date,
      location: injury.location.toLowerCase().replace(/\s+/g, '_'),
      severity: Math.max(1, Math.min(10, injury.severity)),
      trend: injury.trend ?? null,
      limits_running: injury.limits_running ? 1 : 0,
      notes: injury.notes ?? null,
    },
    { source: 'injury_status_log' }
  );

  return id;
}

/**
 * Get injury status by ID
 */
export function getInjuryStatusById(id: string): InjuryStatus | null {
  const row = queryOne<InjuryStatusRow>(
    'SELECT * FROM injury_status WHERE id = ?',
    [id]
  );

  return row ? parseInjuryStatusRow(row) : null;
}

/**
 * Get current active injuries
 */
export function getActiveInjuries(): InjuryStatus[] {
  // Get most recent status for each location
  const rows = query<InjuryStatusRow>(
    `SELECT i1.* FROM injury_status i1
     INNER JOIN (
       SELECT location, MAX(local_date) as max_date
       FROM injury_status
       GROUP BY location
     ) i2 ON i1.location = i2.location AND i1.local_date = i2.max_date
     WHERE i1.severity >= 3
     ORDER BY i1.severity DESC`
  );

  return rows.map(parseInjuryStatusRow);
}

/**
 * Get the most severe active injury
 */
export function getMostSevereInjury(): InjuryStatus | null {
  const injuries = getActiveInjuries();
  return injuries.length > 0 ? injuries[0] : null;
}

/**
 * Get injury history for a location
 */
export function getInjuryHistory(location: string): InjuryStatus[] {
  const normalizedLocation = location.toLowerCase().replace(/\s+/g, '_');
  const rows = query<InjuryStatusRow>(
    'SELECT * FROM injury_status WHERE location = ? ORDER BY local_date DESC',
    [normalizedLocation]
  );

  return rows.map(parseInjuryStatusRow);
}

/**
 * Check if there are any run-limiting injuries
 */
export function hasRunLimitingInjury(): boolean {
  const injuries = getActiveInjuries();
  return injuries.some(i => i.limits_running || i.severity >= 7);
}

/**
 * Get injuries that are worsening
 */
export function getWorseningInjuries(): InjuryStatus[] {
  const injuries = getActiveInjuries();
  return injuries.filter(i => i.trend === 'worsening');
}

/**
 * Mark an injury as resolved (severity 0)
 */
export function resolveInjury(location: string, notes?: string): string {
  return logInjuryStatus({
    local_date: new Date().toISOString().split('T')[0],
    location,
    severity: 0,
    trend: 'improving',
    limits_running: false,
    notes: notes ?? 'Resolved',
  });
}

function parseInjuryStatusRow(row: InjuryStatusRow): InjuryStatus {
  return {
    id: row.id,
    local_date: row.local_date,
    location: row.location,
    severity: row.severity,
    trend: row.trend as InjuryTrend | null,
    limits_running: row.limits_running === 1,
    notes: row.notes,
  };
}

// ===========================================
// HELPERS
// ===========================================

function subtractDays(date: string, days: number): string {
  const d = new Date(date);
  d.setDate(d.getDate() - days);
  return d.toISOString().split('T')[0];
}

/**
 * Get comprehensive life context summary for a date
 */
export function getLifeContextSummary(date?: string): {
  recent_travel: LifeEvent | null;
  travel_days_ago: number | null;
  timezone_change: number | null;
  active_injuries: InjuryStatus[];
  most_severe_injury: InjuryStatus | null;
  has_run_limiting_injury: boolean;
  yesterday_strength: StrengthSession | null;
  recent_life_events: LifeEvent[];
  stress_level: number | null;
} {
  const today = date ?? new Date().toISOString().split('T')[0];

  const recentTravel = getMostRecentTravel();
  let travelDaysAgo: number | null = null;
  let timezoneChange: number | null = null;

  if (recentTravel) {
    const travelDate = new Date(recentTravel.local_date);
    const todayDate = new Date(today);
    travelDaysAgo = Math.floor((todayDate.getTime() - travelDate.getTime()) / (1000 * 60 * 60 * 24));
    timezoneChange = recentTravel.timezone_change_hours;
  }

  const activeInjuries = getActiveInjuries();
  const mostSevereInjury = activeInjuries.length > 0 ? activeInjuries[0] : null;
  const hasRunLimiting = hasRunLimitingInjury();

  const yesterdayStrength = getYesterdayStrengthSession();
  const recentLifeEvents = getRecentLifeEvents(7);

  // Estimate current stress from recent events
  const stressEvents = recentLifeEvents.filter(e => e.event_type === 'stress' || e.event_type === 'work');
  const stressLevel = stressEvents.length > 0
    ? Math.max(...stressEvents.map(e => e.severity ?? 5))
    : null;

  return {
    recent_travel: recentTravel,
    travel_days_ago: travelDaysAgo,
    timezone_change: timezoneChange,
    active_injuries: activeInjuries,
    most_severe_injury: mostSevereInjury,
    has_run_limiting_injury: hasRunLimiting,
    yesterday_strength: yesterdayStrength,
    recent_life_events: recentLifeEvents,
    stress_level: stressLevel,
  };
}
