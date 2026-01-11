/**
 * Pattern Discovery - Learn patterns unique to this athlete
 *
 * Pattern Lifecycle (prevents superstition):
 * - candidate: observed but not acted on (needs more data)
 * - active: reliable enough to influence recommendations
 * - retired: used to be true, no longer holds (seasonality, fitness changes)
 *
 * Evidence Discipline:
 * - Every pattern stores an evidence bundle
 * - Never cite a pattern without showing evidence_count + recency
 */

import { query, queryOne, generateId, insertWithEvent, updateWithEvent } from '../db/client.js';

export type PatternType = 'threshold' | 'cause_effect' | 'correlation' | 'preference' | 'response';
export type PatternDomain = 'training' | 'recovery' | 'performance' | 'schedule' | 'nutrition';
export type PatternStatus = 'candidate' | 'active' | 'retired';

export interface PatternCondition {
  field: string;
  operator: 'gt' | 'lt' | 'gte' | 'lte' | 'eq' | 'between';
  value: number | string | [number, number];
}

export interface PatternOutcome {
  metric: string;
  direction: 'increase' | 'decrease' | 'stable';
  magnitude?: number;
  description: string;
}

export interface PatternEvidence {
  supporting: string[];  // workout/decision IDs that confirm
  contradicting: string[];  // workout/decision IDs that contradict
  last_supporting_date: string | null;
  last_contradicting_date: string | null;
}

export interface DiscoveredPattern {
  id: string;
  name: string;
  type: PatternType;
  domain: PatternDomain;
  description: string;
  conditions: PatternCondition[];
  expected_outcome: PatternOutcome;
  status: PatternStatus;
  evidence: PatternEvidence;
  observations: number;
  confirmations: number;
  confirmation_rate: number;
  last_evaluated_at: string | null;
  created_at: string;
  updated_at: string;
}

interface PatternRow {
  id: string;
  name: string;
  type: string;
  domain: string;
  description: string;
  conditions: string;
  expected_outcome: string;
  status: string;
  evidence: string | null;
  observations: number;
  confirmations: number;
  confirmation_rate: number;
  last_evaluated_at: string | null;
  created_at: string;
  updated_at: string;
}

// Minimum observations before a pattern can become active
const MIN_OBSERVATIONS_FOR_ACTIVE = 5;
// Minimum confirmation rate to become active
const MIN_CONFIRMATION_RATE = 0.70;
// Days without confirmation before considering retirement
const DAYS_STALE_THRESHOLD = 60;

/**
 * Create a new candidate pattern
 */
export function createPattern(pattern: {
  name: string;
  type: PatternType;
  domain: PatternDomain;
  description: string;
  conditions: PatternCondition[];
  expected_outcome: PatternOutcome;
}): string {
  const id = generateId();

  const evidence: PatternEvidence = {
    supporting: [],
    contradicting: [],
    last_supporting_date: null,
    last_contradicting_date: null,
  };

  insertWithEvent(
    'discovered_patterns',
    {
      id,
      name: pattern.name,
      type: pattern.type,
      domain: pattern.domain,
      description: pattern.description,
      conditions: JSON.stringify(pattern.conditions),
      expected_outcome: JSON.stringify(pattern.expected_outcome),
      status: 'candidate',
      evidence: JSON.stringify(evidence),
      observations: 0,
      confirmations: 0,
      last_evaluated_at: null,
    },
    { source: 'pattern_create' }
  );

  return id;
}

/**
 * Get pattern by ID
 */
export function getPatternById(id: string): DiscoveredPattern | null {
  const row = queryOne<PatternRow>(
    'SELECT * FROM discovered_patterns WHERE id = ?',
    [id]
  );

  return row ? parsePatternRow(row) : null;
}

/**
 * Get all active patterns
 */
export function getActivePatterns(): DiscoveredPattern[] {
  const rows = query<PatternRow>(
    `SELECT * FROM discovered_patterns
     WHERE status = 'active'
     ORDER BY confirmation_rate DESC`
  );

  return rows.map(parsePatternRow);
}

/**
 * Get candidate patterns
 */
export function getCandidatePatterns(): DiscoveredPattern[] {
  const rows = query<PatternRow>(
    `SELECT * FROM discovered_patterns
     WHERE status = 'candidate'
     ORDER BY observations DESC`
  );

  return rows.map(parsePatternRow);
}

/**
 * Get patterns by domain
 */
export function getPatternsByDomain(domain: PatternDomain): DiscoveredPattern[] {
  const rows = query<PatternRow>(
    `SELECT * FROM discovered_patterns
     WHERE domain = ? AND status IN ('active', 'candidate')
     ORDER BY status ASC, confirmation_rate DESC`,
    [domain]
  );

  return rows.map(parsePatternRow);
}

/**
 * Get patterns by type
 */
export function getPatternsByType(type: PatternType): DiscoveredPattern[] {
  const rows = query<PatternRow>(
    `SELECT * FROM discovered_patterns
     WHERE type = ? AND status IN ('active', 'candidate')
     ORDER BY confirmation_rate DESC`,
    [type]
  );

  return rows.map(parsePatternRow);
}

/**
 * Record an observation that supports a pattern
 */
export function recordSupportingEvidence(
  patternId: string,
  evidenceId: string,
  date?: string
): void {
  const pattern = getPatternById(patternId);
  if (!pattern) return;

  const evidence = { ...pattern.evidence };
  evidence.supporting.push(evidenceId);
  evidence.last_supporting_date = date ?? new Date().toISOString().split('T')[0];

  const newObservations = pattern.observations + 1;
  const newConfirmations = pattern.confirmations + 1;
  const newConfirmationRate = newConfirmations / newObservations;

  updateWithEvent(
    'discovered_patterns',
    patternId,
    {
      evidence: JSON.stringify(evidence),
      observations: newObservations,
      confirmations: newConfirmations,
      last_evaluated_at: new Date().toISOString(),
    },
    { source: 'pattern_evidence_support' }
  );

  // Check if pattern should be promoted to active
  if (pattern.status === 'candidate' &&
      newObservations >= MIN_OBSERVATIONS_FOR_ACTIVE &&
      newConfirmationRate >= MIN_CONFIRMATION_RATE) {
    promoteToActive(patternId);
  }
}

/**
 * Record an observation that contradicts a pattern
 */
export function recordContradictingEvidence(
  patternId: string,
  evidenceId: string,
  date?: string
): void {
  const pattern = getPatternById(patternId);
  if (!pattern) return;

  const evidence = { ...pattern.evidence };
  evidence.contradicting.push(evidenceId);
  evidence.last_contradicting_date = date ?? new Date().toISOString().split('T')[0];

  const newObservations = pattern.observations + 1;
  const newConfirmationRate = pattern.confirmations / newObservations;

  updateWithEvent(
    'discovered_patterns',
    patternId,
    {
      evidence: JSON.stringify(evidence),
      observations: newObservations,
      last_evaluated_at: new Date().toISOString(),
    },
    { source: 'pattern_evidence_contradict' }
  );

  // Check if active pattern should be demoted
  if (pattern.status === 'active' && newConfirmationRate < MIN_CONFIRMATION_RATE - 0.1) {
    retirePattern(patternId, 'Confirmation rate dropped below threshold');
  }
}

/**
 * Promote a candidate pattern to active
 */
export function promoteToActive(patternId: string): void {
  updateWithEvent(
    'discovered_patterns',
    patternId,
    { status: 'active' },
    { source: 'pattern_promote' }
  );
}

/**
 * Retire an active pattern
 */
export function retirePattern(patternId: string, reason?: string): void {
  updateWithEvent(
    'discovered_patterns',
    patternId,
    { status: 'retired' },
    { source: 'pattern_retire', reason }
  );
}

/**
 * Reactivate a retired pattern
 */
export function reactivatePattern(patternId: string): void {
  const pattern = getPatternById(patternId);
  if (!pattern || pattern.status !== 'retired') return;

  // Reset evidence and go back to candidate status
  const evidence: PatternEvidence = {
    supporting: [],
    contradicting: [],
    last_supporting_date: null,
    last_contradicting_date: null,
  };

  updateWithEvent(
    'discovered_patterns',
    patternId,
    {
      status: 'candidate',
      evidence: JSON.stringify(evidence),
      observations: 0,
      confirmations: 0,
    },
    { source: 'pattern_reactivate' }
  );
}

/**
 * Check for stale patterns that should be retired
 */
export function checkForStalePatterns(): DiscoveredPattern[] {
  const cutoffDate = new Date();
  cutoffDate.setDate(cutoffDate.getDate() - DAYS_STALE_THRESHOLD);
  const cutoff = cutoffDate.toISOString().split('T')[0];

  const activePatterns = getActivePatterns();
  const stalePatterns: DiscoveredPattern[] = [];

  for (const pattern of activePatterns) {
    const lastSupporting = pattern.evidence.last_supporting_date;
    if (!lastSupporting || lastSupporting < cutoff) {
      stalePatterns.push(pattern);
    }
  }

  return stalePatterns;
}

/**
 * Auto-retire stale patterns
 */
export function retireStalePatterns(): number {
  const stale = checkForStalePatterns();
  for (const pattern of stale) {
    retirePattern(pattern.id, 'No recent supporting evidence');
  }
  return stale.length;
}

/**
 * Evaluate if conditions are met for a pattern
 */
export function evaluatePatternConditions(
  pattern: DiscoveredPattern,
  context: Record<string, unknown>
): boolean {
  for (const condition of pattern.conditions) {
    const value = context[condition.field];
    if (value === undefined || value === null) return false;

    switch (condition.operator) {
      case 'gt':
        if (!(Number(value) > Number(condition.value))) return false;
        break;
      case 'lt':
        if (!(Number(value) < Number(condition.value))) return false;
        break;
      case 'gte':
        if (!(Number(value) >= Number(condition.value))) return false;
        break;
      case 'lte':
        if (!(Number(value) <= Number(condition.value))) return false;
        break;
      case 'eq':
        if (value !== condition.value) return false;
        break;
      case 'between':
        if (Array.isArray(condition.value)) {
          const [min, max] = condition.value;
          if (!(Number(value) >= min && Number(value) <= max)) return false;
        }
        break;
    }
  }
  return true;
}

/**
 * Get relevant patterns for a given context
 */
export function getRelevantPatterns(context: Record<string, unknown>): DiscoveredPattern[] {
  const activePatterns = getActivePatterns();
  return activePatterns.filter(p => evaluatePatternConditions(p, context));
}

/**
 * Get pattern statistics
 */
export function getPatternStats(): {
  total: number;
  active: number;
  candidate: number;
  retired: number;
  avg_confirmation_rate: number;
  by_domain: Record<string, number>;
} {
  const total = queryOne<{ count: number }>(
    'SELECT COUNT(*) as count FROM discovered_patterns'
  );

  const byStatus = query<{ status: string; count: number }>(
    `SELECT status, COUNT(*) as count FROM discovered_patterns GROUP BY status`
  );

  const byDomain = query<{ domain: string; count: number }>(
    `SELECT domain, COUNT(*) as count FROM discovered_patterns
     WHERE status IN ('active', 'candidate') GROUP BY domain`
  );

  const avgRate = queryOne<{ avg: number }>(
    `SELECT AVG(confirmation_rate) as avg FROM discovered_patterns WHERE status = 'active'`
  );

  const statusCounts = Object.fromEntries(byStatus.map(r => [r.status, r.count]));

  return {
    total: total?.count ?? 0,
    active: statusCounts['active'] ?? 0,
    candidate: statusCounts['candidate'] ?? 0,
    retired: statusCounts['retired'] ?? 0,
    avg_confirmation_rate: avgRate?.avg ?? 0,
    by_domain: Object.fromEntries(byDomain.map(r => [r.domain, r.count])),
  };
}

/**
 * Format pattern for display
 */
export function formatPattern(pattern: DiscoveredPattern): string {
  const lines: string[] = [
    `[${pattern.status.toUpperCase()}] ${pattern.name}`,
    `  Type: ${pattern.type} | Domain: ${pattern.domain}`,
    `  ${pattern.description}`,
    `  Observations: ${pattern.observations} | Confirmations: ${pattern.confirmations} (${(pattern.confirmation_rate * 100).toFixed(0)}%)`,
  ];

  if (pattern.evidence.last_supporting_date) {
    lines.push(`  Last supported: ${pattern.evidence.last_supporting_date}`);
  }

  return lines.join('\n');
}

/**
 * Suggest patterns based on observed data
 * This is a simplified version - a full implementation would use ML
 */
export function suggestPatterns(
  workouts: Array<{
    type: string;
    hrv_delta?: number;
    sleep_hours?: number;
    rpe?: number;
    performance_score?: number;
  }>
): Array<{
  name: string;
  description: string;
  confidence: number;
}> {
  const suggestions: Array<{ name: string; description: string; confidence: number }> = [];

  // Check for HRV-performance correlation
  const withHrv = workouts.filter(w => w.hrv_delta !== undefined && w.performance_score !== undefined);
  if (withHrv.length >= 5) {
    const lowHrvWorkouts = withHrv.filter(w => w.hrv_delta! < -10);
    const avgPerfLowHrv = lowHrvWorkouts.reduce((sum, w) => sum + (w.performance_score ?? 0), 0) / (lowHrvWorkouts.length || 1);
    const avgPerfOverall = withHrv.reduce((sum, w) => sum + (w.performance_score ?? 0), 0) / withHrv.length;

    if (avgPerfLowHrv < avgPerfOverall * 0.9 && lowHrvWorkouts.length >= 3) {
      suggestions.push({
        name: 'HRV-Performance Link',
        description: 'Performance tends to be lower when HRV is 10%+ below baseline',
        confidence: 0.7,
      });
    }
  }

  // Check for sleep-RPE correlation
  const withSleep = workouts.filter(w => w.sleep_hours !== undefined && w.rpe !== undefined);
  if (withSleep.length >= 5) {
    const lowSleepWorkouts = withSleep.filter(w => w.sleep_hours! < 6);
    const avgRpeLowSleep = lowSleepWorkouts.reduce((sum, w) => sum + (w.rpe ?? 0), 0) / (lowSleepWorkouts.length || 1);
    const avgRpeOverall = withSleep.reduce((sum, w) => sum + (w.rpe ?? 0), 0) / withSleep.length;

    if (avgRpeLowSleep > avgRpeOverall + 1 && lowSleepWorkouts.length >= 3) {
      suggestions.push({
        name: 'Sleep-Effort Link',
        description: 'RPE tends to be higher when sleep is under 6 hours',
        confidence: 0.75,
      });
    }
  }

  return suggestions;
}

/**
 * Parse a database row into DiscoveredPattern
 */
function parsePatternRow(row: PatternRow): DiscoveredPattern {
  const evidence: PatternEvidence = row.evidence
    ? JSON.parse(row.evidence)
    : { supporting: [], contradicting: [], last_supporting_date: null, last_contradicting_date: null };

  return {
    id: row.id,
    name: row.name,
    type: row.type as PatternType,
    domain: row.domain as PatternDomain,
    description: row.description,
    conditions: JSON.parse(row.conditions),
    expected_outcome: JSON.parse(row.expected_outcome),
    status: row.status as PatternStatus,
    evidence,
    observations: row.observations,
    confirmations: row.confirmations,
    confirmation_rate: row.confirmation_rate,
    last_evaluated_at: row.last_evaluated_at,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}
