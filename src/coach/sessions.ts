/**
 * Coach Sessions - Track reproducible coaching interactions
 *
 * Each conversation that produces a recommendation is logged as a session:
 * inputs → tools called → decision(s) → outputs → later outcome signal
 *
 * Enables "Why did you tell me to do this?" without hand-wavy reconstruction.
 */

import { query, queryOne, execute, generateId, insertWithEvent, updateWithEvent } from '../db/client.js';

export interface ToolCall {
  tool: string;
  args: Record<string, unknown>;
  result_summary?: string;
}

export interface Prediction {
  metric: string;
  expected_value: number | string;
  expected_range?: [number, number];
  confidence: number;
}

export interface CoachSession {
  id: string;
  started_at_utc: string;
  user_intent: string | null;
  user_prompt: string | null;
  tool_calls: ToolCall[];
  context_summary: string | null;
  policies_applied: Array<{ id: string; name: string; version: number }>;
  policy_hash: string | null;
  recommendations: Record<string, unknown>[];
  predictions: Prediction[];
  model_info: string | null;
  prompt_version_id: string | null;
  user_feedback: number | null;
  feedback_tags: string[];
  created_at: string;
}

interface SessionRow {
  id: string;
  started_at_utc: string;
  user_intent: string | null;
  user_prompt: string | null;
  tool_calls: string | null;
  context_summary: string | null;
  policies_applied: string | null;
  policy_hash: string | null;
  recommendations: string | null;
  predictions: string | null;
  model_info: string | null;
  prompt_version_id: string | null;
  user_feedback: number | null;
  feedback_tags: string | null;
  created_at: string;
}

/**
 * Start a new coach session
 */
export function startSession(
  userIntent: string,
  userPrompt?: string
): string {
  const id = generateId();
  const now = new Date().toISOString();

  insertWithEvent(
    'coach_sessions',
    {
      id,
      started_at_utc: now,
      user_intent: userIntent,
      user_prompt: userPrompt ?? null,
      tool_calls: JSON.stringify([]),
      context_summary: null,
      policies_applied: JSON.stringify([]),
      policy_hash: null,
      recommendations: JSON.stringify([]),
      predictions: JSON.stringify([]),
      model_info: null,
      prompt_version_id: null,
      user_feedback: null,
      feedback_tags: JSON.stringify([]),
    },
    { source: 'session_start' }
  );

  return id;
}

/**
 * Get session by ID
 */
export function getSessionById(id: string): CoachSession | null {
  const row = queryOne<SessionRow>(
    'SELECT * FROM coach_sessions WHERE id = ?',
    [id]
  );

  return row ? parseSessionRow(row) : null;
}

/**
 * Get recent sessions
 */
export function getRecentSessions(limit: number = 10): CoachSession[] {
  const rows = query<SessionRow>(
    'SELECT * FROM coach_sessions ORDER BY started_at_utc DESC LIMIT ?',
    [limit]
  );

  return rows.map(parseSessionRow);
}

/**
 * Get sessions for a date range
 */
export function getSessionsInRange(startDate: string, endDate: string): CoachSession[] {
  const rows = query<SessionRow>(
    `SELECT * FROM coach_sessions
     WHERE DATE(started_at_utc) >= ? AND DATE(started_at_utc) <= ?
     ORDER BY started_at_utc DESC`,
    [startDate, endDate]
  );

  return rows.map(parseSessionRow);
}

/**
 * Log a tool call during a session
 */
export function logToolCall(
  sessionId: string,
  tool: string,
  args: Record<string, unknown>,
  resultSummary?: string
): void {
  const session = getSessionById(sessionId);
  if (!session) return;

  const toolCalls = [...session.tool_calls, { tool, args, result_summary: resultSummary }];

  execute(
    'UPDATE coach_sessions SET tool_calls = ? WHERE id = ?',
    [JSON.stringify(toolCalls), sessionId]
  );
}

/**
 * Set context summary for a session
 */
export function setContextSummary(sessionId: string, summary: string): void {
  execute(
    'UPDATE coach_sessions SET context_summary = ? WHERE id = ?',
    [summary, sessionId]
  );
}

/**
 * Set policies applied during session
 */
export function setPoliciesApplied(
  sessionId: string,
  policies: Array<{ id: string; name: string; version: number }>,
  policyHash: string
): void {
  execute(
    'UPDATE coach_sessions SET policies_applied = ?, policy_hash = ? WHERE id = ?',
    [JSON.stringify(policies), policyHash, sessionId]
  );
}

/**
 * Add a recommendation to the session
 */
export function addRecommendation(
  sessionId: string,
  recommendation: Record<string, unknown>
): void {
  const session = getSessionById(sessionId);
  if (!session) return;

  const recommendations = [...session.recommendations, recommendation];

  execute(
    'UPDATE coach_sessions SET recommendations = ? WHERE id = ?',
    [JSON.stringify(recommendations), sessionId]
  );
}

/**
 * Set predictions made during session
 */
export function setPredictions(sessionId: string, predictions: Prediction[]): void {
  execute(
    'UPDATE coach_sessions SET predictions = ? WHERE id = ?',
    [JSON.stringify(predictions), sessionId]
  );
}

/**
 * Add a prediction to the session
 */
export function addPrediction(sessionId: string, prediction: Prediction): void {
  const session = getSessionById(sessionId);
  if (!session) return;

  const predictions = [...session.predictions, prediction];

  execute(
    'UPDATE coach_sessions SET predictions = ? WHERE id = ?',
    [JSON.stringify(predictions), sessionId]
  );
}

/**
 * Set model info for the session
 */
export function setModelInfo(sessionId: string, modelInfo: string): void {
  execute(
    'UPDATE coach_sessions SET model_info = ? WHERE id = ?',
    [modelInfo, sessionId]
  );
}

/**
 * Set prompt version for the session
 */
export function setPromptVersion(sessionId: string, promptVersionId: string): void {
  execute(
    'UPDATE coach_sessions SET prompt_version_id = ? WHERE id = ?',
    [promptVersionId, sessionId]
  );
}

/**
 * Record user feedback on a session
 */
export function recordFeedback(
  sessionId: string,
  rating: number,
  tags?: string[]
): void {
  const validRating = Math.max(1, Math.min(5, rating));

  updateWithEvent(
    'coach_sessions',
    sessionId,
    {
      user_feedback: validRating,
      feedback_tags: JSON.stringify(tags ?? []),
    },
    { source: 'session_feedback' }
  );
}

/**
 * Get sessions with low feedback for analysis
 */
export function getLowFeedbackSessions(maxRating: number = 2): CoachSession[] {
  const rows = query<SessionRow>(
    `SELECT * FROM coach_sessions
     WHERE user_feedback IS NOT NULL AND user_feedback <= ?
     ORDER BY started_at_utc DESC`,
    [maxRating]
  );

  return rows.map(parseSessionRow);
}

/**
 * Get sessions by feedback tag
 */
export function getSessionsByFeedbackTag(tag: string): CoachSession[] {
  const rows = query<SessionRow>(
    `SELECT * FROM coach_sessions
     WHERE feedback_tags LIKE ?
     ORDER BY started_at_utc DESC`,
    [`%"${tag}"%`]
  );

  return rows.map(parseSessionRow);
}

/**
 * Get session statistics
 */
export function getSessionStats(daysBack: number = 30): {
  total_sessions: number;
  avg_feedback: number;
  feedback_distribution: Record<number, number>;
  common_tags: Array<{ tag: string; count: number }>;
  sessions_with_predictions: number;
} {
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - daysBack);
  const cutoffStr = cutoff.toISOString();

  const total = queryOne<{ count: number }>(
    'SELECT COUNT(*) as count FROM coach_sessions WHERE started_at_utc >= ?',
    [cutoffStr]
  );

  const avgFeedback = queryOne<{ avg: number }>(
    'SELECT AVG(user_feedback) as avg FROM coach_sessions WHERE started_at_utc >= ? AND user_feedback IS NOT NULL',
    [cutoffStr]
  );

  const feedbackDist = query<{ rating: number; count: number }>(
    `SELECT user_feedback as rating, COUNT(*) as count
     FROM coach_sessions
     WHERE started_at_utc >= ? AND user_feedback IS NOT NULL
     GROUP BY user_feedback`,
    [cutoffStr]
  );

  const withPredictions = queryOne<{ count: number }>(
    `SELECT COUNT(*) as count FROM coach_sessions
     WHERE started_at_utc >= ? AND predictions != '[]'`,
    [cutoffStr]
  );

  // Count tags (simplified - just count occurrences)
  const sessions = query<{ feedback_tags: string }>(
    'SELECT feedback_tags FROM coach_sessions WHERE started_at_utc >= ? AND feedback_tags != \'[]\'',
    [cutoffStr]
  );

  const tagCounts: Record<string, number> = {};
  for (const row of sessions) {
    try {
      const tags = JSON.parse(row.feedback_tags);
      for (const tag of tags) {
        tagCounts[tag] = (tagCounts[tag] || 0) + 1;
      }
    } catch {
      // Skip malformed tags
    }
  }

  const commonTags = Object.entries(tagCounts)
    .map(([tag, count]) => ({ tag, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 10);

  return {
    total_sessions: total?.count ?? 0,
    avg_feedback: avgFeedback?.avg ?? 0,
    feedback_distribution: Object.fromEntries(feedbackDist.map(r => [r.rating, r.count])),
    common_tags: commonTags,
    sessions_with_predictions: withPredictions?.count ?? 0,
  };
}

/**
 * Format session for display/debugging
 */
export function formatSession(session: CoachSession): string {
  const lines: string[] = [
    `Session: ${session.id}`,
    `Started: ${session.started_at_utc}`,
    `Intent: ${session.user_intent || 'not recorded'}`,
  ];

  if (session.context_summary) {
    lines.push(`Context: ${session.context_summary}`);
  }

  if (session.tool_calls.length > 0) {
    lines.push(`Tools called: ${session.tool_calls.map(t => t.tool).join(', ')}`);
  }

  if (session.policies_applied.length > 0) {
    lines.push(`Policies: ${session.policies_applied.map(p => `${p.name} v${p.version}`).join(', ')}`);
    if (session.policy_hash) {
      lines.push(`Policy hash: ${session.policy_hash}`);
    }
  }

  if (session.recommendations.length > 0) {
    lines.push(`Recommendations: ${session.recommendations.length}`);
  }

  if (session.predictions.length > 0) {
    lines.push(`Predictions: ${session.predictions.map(p => p.metric).join(', ')}`);
  }

  if (session.user_feedback !== null) {
    lines.push(`Feedback: ${session.user_feedback}/5`);
    if (session.feedback_tags.length > 0) {
      lines.push(`Tags: ${session.feedback_tags.join(', ')}`);
    }
  }

  return lines.join('\n');
}

/**
 * Complete a session with final data
 */
export function completeSession(
  sessionId: string,
  data: {
    context_summary?: string;
    policies_applied?: Array<{ id: string; name: string; version: number }>;
    policy_hash?: string;
    recommendations?: Record<string, unknown>[];
    predictions?: Prediction[];
    model_info?: string;
    prompt_version_id?: string;
  }
): void {
  const updates: Record<string, unknown> = {};

  if (data.context_summary) updates.context_summary = data.context_summary;
  if (data.policies_applied) updates.policies_applied = JSON.stringify(data.policies_applied);
  if (data.policy_hash) updates.policy_hash = data.policy_hash;
  if (data.recommendations) updates.recommendations = JSON.stringify(data.recommendations);
  if (data.predictions) updates.predictions = JSON.stringify(data.predictions);
  if (data.model_info) updates.model_info = data.model_info;
  if (data.prompt_version_id) updates.prompt_version_id = data.prompt_version_id;

  if (Object.keys(updates).length > 0) {
    updateWithEvent(
      'coach_sessions',
      sessionId,
      updates,
      { source: 'session_complete' }
    );
  }
}

/**
 * Parse a database row into CoachSession
 */
function parseSessionRow(row: SessionRow): CoachSession {
  return {
    id: row.id,
    started_at_utc: row.started_at_utc,
    user_intent: row.user_intent,
    user_prompt: row.user_prompt,
    tool_calls: row.tool_calls ? JSON.parse(row.tool_calls) : [],
    context_summary: row.context_summary,
    policies_applied: row.policies_applied ? JSON.parse(row.policies_applied) : [],
    policy_hash: row.policy_hash,
    recommendations: row.recommendations ? JSON.parse(row.recommendations) : [],
    predictions: row.predictions ? JSON.parse(row.predictions) : [],
    model_info: row.model_info,
    prompt_version_id: row.prompt_version_id,
    user_feedback: row.user_feedback,
    feedback_tags: row.feedback_tags ? JSON.parse(row.feedback_tags) : [],
    created_at: row.created_at,
  };
}
