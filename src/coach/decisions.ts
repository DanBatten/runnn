/**
 * Decision Tracing - Log and assess coaching decisions
 *
 * Every coaching decision is logged with:
 * - Context that led to the decision
 * - The decision itself
 * - Reasoning
 * - Later: outcome tracking and lessons learned
 */

import { query, queryOne, generateId, insertWithEvent, updateWithEvent } from '../db/client.js';

export type DecisionType = 'adaptation' | 'prescription' | 'recommendation' | 'warning' | 'block';

export interface CoachingDecision {
  id: string;
  coach_session_id: string | null;
  date: string;
  type: DecisionType;
  situation: Record<string, unknown>;
  decision: Record<string, unknown>;
  reasoning: string;
  was_followed: boolean | null;
  outcome_assessed_at: string | null;
  outcome_success: number | null;
  outcome_notes: string | null;
  lesson_learned: string | null;
  workout_id: string | null;
  created_at: string;
}

interface DecisionRow {
  id: string;
  coach_session_id: string | null;
  date: string;
  type: string;
  situation: string;
  decision: string;
  reasoning: string;
  was_followed: number | null;
  outcome_assessed_at: string | null;
  outcome_success: number | null;
  outcome_notes: string | null;
  lesson_learned: string | null;
  workout_id: string | null;
  created_at: string;
}

/**
 * Create a new coaching decision
 */
export function createDecision(
  type: DecisionType,
  situation: Record<string, unknown>,
  decision: Record<string, unknown>,
  reasoning: string,
  options?: {
    coach_session_id?: string;
    workout_id?: string;
    date?: string;
  }
): string {
  const id = generateId();
  const date = options?.date ?? new Date().toISOString().split('T')[0];

  insertWithEvent(
    'coaching_decisions',
    {
      id,
      coach_session_id: options?.coach_session_id ?? null,
      date,
      type,
      situation: JSON.stringify(situation),
      decision: JSON.stringify(decision),
      reasoning,
      was_followed: null,
      outcome_assessed_at: null,
      outcome_success: null,
      outcome_notes: null,
      lesson_learned: null,
      workout_id: options?.workout_id ?? null,
    },
    { source: 'decision_create' }
  );

  return id;
}

/**
 * Get decision by ID
 */
export function getDecisionById(id: string): CoachingDecision | null {
  const row = queryOne<DecisionRow>(
    'SELECT * FROM coaching_decisions WHERE id = ?',
    [id]
  );

  return row ? parseDecisionRow(row) : null;
}

/**
 * Get decisions for a date
 */
export function getDecisionsByDate(date: string): CoachingDecision[] {
  const rows = query<DecisionRow>(
    'SELECT * FROM coaching_decisions WHERE date = ? ORDER BY created_at DESC',
    [date]
  );

  return rows.map(parseDecisionRow);
}

/**
 * Get decisions for a workout
 */
export function getDecisionsByWorkout(workoutId: string): CoachingDecision[] {
  const rows = query<DecisionRow>(
    'SELECT * FROM coaching_decisions WHERE workout_id = ? ORDER BY created_at DESC',
    [workoutId]
  );

  return rows.map(parseDecisionRow);
}

/**
 * Get recent decisions
 */
export function getRecentDecisions(limit: number = 20): CoachingDecision[] {
  const rows = query<DecisionRow>(
    'SELECT * FROM coaching_decisions ORDER BY created_at DESC LIMIT ?',
    [limit]
  );

  return rows.map(parseDecisionRow);
}

/**
 * Get decisions pending outcome assessment
 */
export function getPendingOutcomeDecisions(): CoachingDecision[] {
  const rows = query<DecisionRow>(
    `SELECT * FROM coaching_decisions
     WHERE outcome_assessed_at IS NULL
     AND type IN ('adaptation', 'prescription', 'recommendation')
     ORDER BY date DESC`
  );

  return rows.map(parseDecisionRow);
}

/**
 * Record whether the decision was followed
 */
export function recordDecisionFollowed(id: string, wasFollowed: boolean): void {
  updateWithEvent(
    'coaching_decisions',
    id,
    { was_followed: wasFollowed ? 1 : 0 },
    { source: 'decision_follow_record' }
  );
}

/**
 * Assess decision outcome
 */
export function assessDecisionOutcome(
  id: string,
  success: number,
  notes: string,
  lesson?: string
): void {
  const now = new Date().toISOString();

  updateWithEvent(
    'coaching_decisions',
    id,
    {
      outcome_assessed_at: now,
      outcome_success: Math.max(0, Math.min(1, success)),
      outcome_notes: notes,
      lesson_learned: lesson ?? null,
    },
    { source: 'decision_outcome_assess' }
  );
}

/**
 * Link decision to workout
 */
export function linkDecisionToWorkout(decisionId: string, workoutId: string): void {
  updateWithEvent(
    'coaching_decisions',
    decisionId,
    { workout_id: workoutId },
    { source: 'decision_workout_link' }
  );
}

/**
 * Get decision statistics
 */
export function getDecisionStats(daysBack: number = 30): {
  total: number;
  by_type: Record<string, number>;
  followed_rate: number;
  avg_success: number;
  lessons_learned: number;
} {
  const cutoffDate = new Date();
  cutoffDate.setDate(cutoffDate.getDate() - daysBack);
  const cutoff = cutoffDate.toISOString().split('T')[0];

  const total = queryOne<{ count: number }>(
    'SELECT COUNT(*) as count FROM coaching_decisions WHERE date >= ?',
    [cutoff]
  );

  const byType = query<{ type: string; count: number }>(
    `SELECT type, COUNT(*) as count
     FROM coaching_decisions WHERE date >= ?
     GROUP BY type`,
    [cutoff]
  );

  const followed = queryOne<{ total: number; followed: number }>(
    `SELECT
       COUNT(*) as total,
       SUM(CASE WHEN was_followed = 1 THEN 1 ELSE 0 END) as followed
     FROM coaching_decisions
     WHERE date >= ? AND was_followed IS NOT NULL`,
    [cutoff]
  );

  const success = queryOne<{ avg_success: number }>(
    `SELECT AVG(outcome_success) as avg_success
     FROM coaching_decisions
     WHERE date >= ? AND outcome_success IS NOT NULL`,
    [cutoff]
  );

  const lessons = queryOne<{ count: number }>(
    `SELECT COUNT(*) as count
     FROM coaching_decisions
     WHERE date >= ? AND lesson_learned IS NOT NULL`,
    [cutoff]
  );

  return {
    total: total?.count ?? 0,
    by_type: Object.fromEntries(byType.map(r => [r.type, r.count])),
    followed_rate: followed && followed.total > 0 ? followed.followed / followed.total : 0,
    avg_success: success?.avg_success ?? 0,
    lessons_learned: lessons?.count ?? 0,
  };
}

/**
 * Get lessons learned from past decisions
 */
export function getLessonsLearned(limit: number = 10): Array<{
  decision_type: string;
  situation_summary: string;
  lesson: string;
  success_rate: number;
}> {
  const rows = query<DecisionRow>(
    `SELECT *
     FROM coaching_decisions
     WHERE lesson_learned IS NOT NULL
     ORDER BY outcome_assessed_at DESC
     LIMIT ?`,
    [limit]
  );

  return rows.map(row => {
    const decision = parseDecisionRow(row);
    return {
      decision_type: decision.type,
      situation_summary: summarizeSituation(decision.situation),
      lesson: decision.lesson_learned!,
      success_rate: decision.outcome_success ?? 0,
    };
  });
}

/**
 * Format decision for display/debugging
 */
export function formatDecision(decision: CoachingDecision): string {
  const lines: string[] = [
    `Decision: ${decision.id}`,
    `Type: ${decision.type}`,
    `Date: ${decision.date}`,
    `Situation: ${summarizeSituation(decision.situation)}`,
    `Decision: ${JSON.stringify(decision.decision)}`,
    `Reasoning: ${decision.reasoning}`,
  ];

  if (decision.was_followed !== null) {
    lines.push(`Followed: ${decision.was_followed ? 'Yes' : 'No'}`);
  }

  if (decision.outcome_success !== null) {
    lines.push(`Outcome: ${(decision.outcome_success * 100).toFixed(0)}% success`);
    if (decision.outcome_notes) {
      lines.push(`Notes: ${decision.outcome_notes}`);
    }
  }

  if (decision.lesson_learned) {
    lines.push(`Lesson: ${decision.lesson_learned}`);
  }

  return lines.join('\n');
}

/**
 * Create a brief summary of the situation
 */
function summarizeSituation(situation: Record<string, unknown>): string {
  const parts: string[] = [];

  if (situation.sleep_hours) parts.push(`sleep: ${situation.sleep_hours}hr`);
  if (situation.hrv_delta_pct !== undefined) {
    const hrv = Number(situation.hrv_delta_pct);
    parts.push(`HRV: ${hrv > 0 ? '+' : ''}${hrv}%`);
  }
  if (situation.rhr_delta_pct !== undefined) {
    const rhr = Number(situation.rhr_delta_pct);
    parts.push(`RHR: ${rhr > 0 ? '+' : ''}${rhr}%`);
  }
  if (situation.planned_workout_type) parts.push(`workout: ${situation.planned_workout_type}`);
  if (situation.injury_severity) parts.push(`injury: ${situation.injury_severity}/10`);

  return parts.length > 0 ? parts.join(', ') : JSON.stringify(situation).slice(0, 100);
}

/**
 * Parse a database row into CoachingDecision
 */
function parseDecisionRow(row: DecisionRow): CoachingDecision {
  return {
    id: row.id,
    coach_session_id: row.coach_session_id,
    date: row.date,
    type: row.type as DecisionType,
    situation: JSON.parse(row.situation),
    decision: JSON.parse(row.decision),
    reasoning: row.reasoning,
    was_followed: row.was_followed === null ? null : row.was_followed === 1,
    outcome_assessed_at: row.outcome_assessed_at,
    outcome_success: row.outcome_success,
    outcome_notes: row.outcome_notes,
    lesson_learned: row.lesson_learned,
    workout_id: row.workout_id,
    created_at: row.created_at,
  };
}
