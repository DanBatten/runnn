/**
 * Knowledge System - Manage athlete knowledge (what the coach has learned)
 *
 * Three types of knowledge:
 * - preference: "prefers Sunday long runs"
 * - response_pattern: "HRV drops 15% after travel, needs 2 days"
 * - life_factor: "high stress weeks correlate with elevated RHR"
 */

import { query, queryOne, execute, generateId, insertWithEvent, updateWithEvent } from '../db/client.js';

export type KnowledgeType = 'preference' | 'response_pattern' | 'life_factor';
export type KnowledgeCategory = 'training' | 'recovery' | 'schedule' | 'injury' | 'nutrition' | 'equipment';
export type KnowledgeSource = 'observed' | 'stated' | 'inferred';

export interface AthleteKnowledge {
  id: string;
  type: KnowledgeType;
  category: KnowledgeCategory;
  key: string;
  value: Record<string, unknown>;
  confidence: number;
  evidence_count: number;
  source: KnowledgeSource;
  first_observed_at: string;
  last_confirmed_at: string;
  is_active: number;
}

interface KnowledgeRow {
  id: string;
  type: string;
  category: string;
  key: string;
  value: string;
  confidence: number;
  evidence_count: number;
  source: string;
  first_observed_at: string;
  last_confirmed_at: string;
  is_active: number;
}

/**
 * Create a new piece of athlete knowledge
 */
export function createKnowledge(
  type: KnowledgeType,
  category: KnowledgeCategory,
  key: string,
  value: Record<string, unknown>,
  source: KnowledgeSource,
  confidence: number = 0.5
): string {
  const id = generateId();
  const now = new Date().toISOString();

  insertWithEvent(
    'athlete_knowledge',
    {
      id,
      type,
      category,
      key,
      value: JSON.stringify(value),
      confidence,
      evidence_count: 1,
      source,
      first_observed_at: now,
      last_confirmed_at: now,
      is_active: 1,
    },
    { source: 'knowledge_create' }
  );

  return id;
}

/**
 * Get knowledge by ID
 */
export function getKnowledgeById(id: string): AthleteKnowledge | null {
  const row = queryOne<KnowledgeRow>(
    'SELECT * FROM athlete_knowledge WHERE id = ?',
    [id]
  );

  return row ? parseKnowledgeRow(row) : null;
}

/**
 * Get knowledge by key
 */
export function getKnowledgeByKey(key: string): AthleteKnowledge | null {
  const row = queryOne<KnowledgeRow>(
    'SELECT * FROM athlete_knowledge WHERE key = ? AND is_active = 1',
    [key]
  );

  return row ? parseKnowledgeRow(row) : null;
}

/**
 * Get all active knowledge
 */
export function getActiveKnowledge(): AthleteKnowledge[] {
  const rows = query<KnowledgeRow>(
    'SELECT * FROM athlete_knowledge WHERE is_active = 1 ORDER BY last_confirmed_at DESC'
  );

  return rows.map(parseKnowledgeRow);
}

/**
 * Get knowledge by type
 */
export function getKnowledgeByType(type: KnowledgeType): AthleteKnowledge[] {
  const rows = query<KnowledgeRow>(
    'SELECT * FROM athlete_knowledge WHERE type = ? AND is_active = 1 ORDER BY confidence DESC',
    [type]
  );

  return rows.map(parseKnowledgeRow);
}

/**
 * Get knowledge by category
 */
export function getKnowledgeByCategory(category: KnowledgeCategory): AthleteKnowledge[] {
  const rows = query<KnowledgeRow>(
    'SELECT * FROM athlete_knowledge WHERE category = ? AND is_active = 1 ORDER BY confidence DESC',
    [category]
  );

  return rows.map(parseKnowledgeRow);
}

/**
 * Get high-confidence knowledge (confidence >= threshold)
 */
export function getHighConfidenceKnowledge(threshold: number = 0.7): AthleteKnowledge[] {
  const rows = query<KnowledgeRow>(
    'SELECT * FROM athlete_knowledge WHERE is_active = 1 AND confidence >= ? ORDER BY confidence DESC',
    [threshold]
  );

  return rows.map(parseKnowledgeRow);
}

/**
 * Search knowledge by text in key or value
 */
export function searchKnowledge(searchTerm: string): AthleteKnowledge[] {
  const term = `%${searchTerm.toLowerCase()}%`;
  const rows = query<KnowledgeRow>(
    `SELECT * FROM athlete_knowledge
     WHERE is_active = 1
     AND (LOWER(key) LIKE ? OR LOWER(value) LIKE ?)
     ORDER BY confidence DESC`,
    [term, term]
  );

  return rows.map(parseKnowledgeRow);
}

/**
 * Update knowledge value
 */
export function updateKnowledge(
  id: string,
  value: Record<string, unknown>,
  incrementEvidence: boolean = false
): void {
  const now = new Date().toISOString();
  const updates: Record<string, unknown> = {
    value: JSON.stringify(value),
    last_confirmed_at: now,
  };

  if (incrementEvidence) {
    execute(
      `UPDATE athlete_knowledge
       SET value = ?, last_confirmed_at = ?, evidence_count = evidence_count + 1
       WHERE id = ?`,
      [JSON.stringify(value), now, id]
    );
  } else {
    updateWithEvent(
      'athlete_knowledge',
      id,
      updates,
      { source: 'knowledge_update' }
    );
  }
}

/**
 * Confirm existing knowledge (updates last_confirmed_at and evidence_count)
 */
export function confirmKnowledge(id: string): void {
  const now = new Date().toISOString();
  execute(
    `UPDATE athlete_knowledge
     SET last_confirmed_at = ?, evidence_count = evidence_count + 1
     WHERE id = ?`,
    [now, id]
  );
}

/**
 * Update knowledge confidence
 */
export function updateKnowledgeConfidence(id: string, confidence: number): void {
  updateWithEvent(
    'athlete_knowledge',
    id,
    { confidence: Math.max(0, Math.min(1, confidence)) },
    { source: 'knowledge_confidence_update' }
  );
}

/**
 * Increase confidence based on confirmation
 */
export function increaseConfidence(id: string, amount: number = 0.1): void {
  const knowledge = getKnowledgeById(id);
  if (knowledge) {
    const newConfidence = Math.min(1, knowledge.confidence + amount);
    updateKnowledgeConfidence(id, newConfidence);
    confirmKnowledge(id);
  }
}

/**
 * Decrease confidence based on contradiction
 */
export function decreaseConfidence(id: string, amount: number = 0.15): void {
  const knowledge = getKnowledgeById(id);
  if (knowledge) {
    const newConfidence = Math.max(0, knowledge.confidence - amount);
    updateKnowledgeConfidence(id, newConfidence);
  }
}

/**
 * Deactivate knowledge (soft delete)
 */
export function deactivateKnowledge(id: string): void {
  updateWithEvent(
    'athlete_knowledge',
    id,
    { is_active: 0 },
    { source: 'knowledge_deactivate' }
  );
}

/**
 * Reactivate knowledge
 */
export function reactivateKnowledge(id: string): void {
  updateWithEvent(
    'athlete_knowledge',
    id,
    { is_active: 1 },
    { source: 'knowledge_reactivate' }
  );
}

/**
 * Add or update knowledge (upsert by key)
 */
export function upsertKnowledge(
  type: KnowledgeType,
  category: KnowledgeCategory,
  key: string,
  value: Record<string, unknown>,
  source: KnowledgeSource,
  confidence?: number
): string {
  const existing = getKnowledgeByKey(key);

  if (existing) {
    updateKnowledge(existing.id, value, true);
    if (confidence !== undefined) {
      updateKnowledgeConfidence(existing.id, confidence);
    }
    return existing.id;
  } else {
    return createKnowledge(type, category, key, value, source, confidence);
  }
}

/**
 * Get knowledge summary for context loading
 */
export function getKnowledgeSummary(): {
  total: number;
  by_type: Record<string, number>;
  by_category: Record<string, number>;
  high_confidence: number;
} {
  const total = queryOne<{ count: number }>(
    'SELECT COUNT(*) as count FROM athlete_knowledge WHERE is_active = 1'
  );

  const byType = query<{ type: string; count: number }>(
    `SELECT type, COUNT(*) as count
     FROM athlete_knowledge WHERE is_active = 1
     GROUP BY type`
  );

  const byCategory = query<{ category: string; count: number }>(
    `SELECT category, COUNT(*) as count
     FROM athlete_knowledge WHERE is_active = 1
     GROUP BY category`
  );

  const highConf = queryOne<{ count: number }>(
    'SELECT COUNT(*) as count FROM athlete_knowledge WHERE is_active = 1 AND confidence >= 0.7'
  );

  return {
    total: total?.count ?? 0,
    by_type: Object.fromEntries(byType.map(r => [r.type, r.count])),
    by_category: Object.fromEntries(byCategory.map(r => [r.category, r.count])),
    high_confidence: highConf?.count ?? 0,
  };
}

/**
 * Get relevant knowledge for a given context
 * Returns knowledge that might be useful for the current situation
 */
export function getRelevantKnowledge(context: {
  workout_type?: string;
  day_of_week?: string;
  has_injury?: boolean;
  travel_days_ago?: number;
  categories?: KnowledgeCategory[];
}): AthleteKnowledge[] {
  const results: AthleteKnowledge[] = [];
  const seenIds = new Set<string>();

  // Get by categories if specified
  if (context.categories && context.categories.length > 0) {
    for (const cat of context.categories) {
      const knowledge = getKnowledgeByCategory(cat);
      for (const k of knowledge) {
        if (!seenIds.has(k.id)) {
          results.push(k);
          seenIds.add(k.id);
        }
      }
    }
  }

  // Get schedule preferences for day of week
  if (context.day_of_week) {
    const scheduleKnowledge = searchKnowledge(context.day_of_week);
    for (const k of scheduleKnowledge) {
      if (!seenIds.has(k.id)) {
        results.push(k);
        seenIds.add(k.id);
      }
    }
  }

  // Get training preferences for workout type
  if (context.workout_type) {
    const trainingKnowledge = searchKnowledge(context.workout_type);
    for (const k of trainingKnowledge) {
      if (!seenIds.has(k.id)) {
        results.push(k);
        seenIds.add(k.id);
      }
    }
  }

  // Get injury-related knowledge if relevant
  if (context.has_injury) {
    const injuryKnowledge = getKnowledgeByCategory('injury');
    for (const k of injuryKnowledge) {
      if (!seenIds.has(k.id)) {
        results.push(k);
        seenIds.add(k.id);
      }
    }
  }

  // Get recovery knowledge if recently traveled
  if (context.travel_days_ago !== undefined && context.travel_days_ago <= 3) {
    const recoveryKnowledge = getKnowledgeByCategory('recovery');
    for (const k of recoveryKnowledge) {
      if (!seenIds.has(k.id)) {
        results.push(k);
        seenIds.add(k.id);
      }
    }
  }

  // If no specific context, return high-confidence knowledge
  if (results.length === 0) {
    return getHighConfidenceKnowledge(0.6);
  }

  // Sort by confidence
  return results.sort((a, b) => b.confidence - a.confidence);
}

/**
 * Format knowledge for display/prompt
 */
export function formatKnowledge(knowledge: AthleteKnowledge): string {
  const confidenceLabel =
    knowledge.confidence >= 0.8 ? 'high confidence' :
    knowledge.confidence >= 0.5 ? 'moderate confidence' :
    'low confidence';

  return `[${knowledge.type}] ${knowledge.key}: ${JSON.stringify(knowledge.value)} (${confidenceLabel}, ${knowledge.evidence_count} observations)`;
}

/**
 * Parse a database row into AthleteKnowledge
 */
function parseKnowledgeRow(row: KnowledgeRow): AthleteKnowledge {
  return {
    id: row.id,
    type: row.type as KnowledgeType,
    category: row.category as KnowledgeCategory,
    key: row.key,
    value: JSON.parse(row.value),
    confidence: row.confidence,
    evidence_count: row.evidence_count,
    source: row.source as KnowledgeSource,
    first_observed_at: row.first_observed_at,
    last_confirmed_at: row.last_confirmed_at,
    is_active: row.is_active,
  };
}
