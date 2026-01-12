#!/usr/bin/env tsx
/**
 * Import bloodwork/lab results into the database
 *
 * Usage:
 *   npx tsx scripts/import-bloodwork.ts <json-file>
 *
 * Or import programmatically.
 */

import { initializeDb, closeDb, getDb, insertWithEvent, query } from '../src/db/client.js';
import { nanoid } from 'nanoid';

export interface LabPanelInput {
  collection_date: string;  // YYYY-MM-DD
  lab_name?: string;
  fasting?: boolean;
  notes?: string;
  results: BiomarkerInput[];
}

export interface BiomarkerInput {
  marker_name: string;
  marker_code?: string;
  category: string;
  value: number;
  unit: string;
  value_text?: string;
  ref_range_low?: number;
  ref_range_high?: number;
  ref_range_text?: string;
  flag?: 'HIGH' | 'LOW' | 'NORMAL' | 'ABNORMAL';
  is_critical?: boolean;
  athletic_notes?: string;
}

/**
 * Import a lab panel with all its results
 */
export function importLabPanel(panel: LabPanelInput): string {
  const db = getDb();

  // Check for existing panel on same date from same lab
  const existing = query<{ id: string }>(
    'SELECT id FROM lab_panels WHERE collection_date = ? AND (lab_name = ? OR (lab_name IS NULL AND ? IS NULL))',
    [panel.collection_date, panel.lab_name ?? null, panel.lab_name ?? null]
  );

  if (existing.length > 0) {
    console.log(`Lab panel for ${panel.collection_date} already exists, skipping`);
    return existing[0].id;
  }

  // Create lab panel
  const panelId = nanoid();
  insertWithEvent(
    'lab_panels',
    {
      id: panelId,
      collection_date: panel.collection_date,
      lab_name: panel.lab_name ?? null,
      fasting: panel.fasting ? 1 : 0,
      notes: panel.notes ?? null,
    },
    { source: 'bloodwork_import' }
  );

  console.log(`Created lab panel ${panelId} for ${panel.collection_date}`);

  // Import each result
  let imported = 0;
  for (const result of panel.results) {
    const resultId = nanoid();

    // Get athletic reference from database if available
    const athleticRef = query<{
      athletic_optimal_low: number | null;
      athletic_optimal_high: number | null;
    }>(
      'SELECT athletic_optimal_low, athletic_optimal_high FROM biomarker_reference WHERE marker_name = ?',
      [result.marker_name]
    )[0];

    db.prepare(`
      INSERT INTO biomarker_results (
        id, lab_panel_id, marker_name, marker_code, category,
        value, unit, value_text,
        ref_range_low, ref_range_high, ref_range_text,
        flag, is_critical,
        athletic_optimal_low, athletic_optimal_high, athletic_notes
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      resultId,
      panelId,
      result.marker_name,
      result.marker_code ?? null,
      result.category,
      result.value,
      result.unit,
      result.value_text ?? null,
      result.ref_range_low ?? null,
      result.ref_range_high ?? null,
      result.ref_range_text ?? null,
      result.flag ?? 'NORMAL',
      result.is_critical ? 1 : 0,
      athleticRef?.athletic_optimal_low ?? null,
      athleticRef?.athletic_optimal_high ?? null,
      result.athletic_notes ?? null
    );

    imported++;
  }

  console.log(`  Imported ${imported} biomarker results`);
  return panelId;
}

/**
 * Import insights for a lab panel
 */
export function importInsight(panelId: string, insight: {
  insight_type: string;
  category: string;
  title: string;
  summary: string;
  details?: string;
  related_markers?: string[];
  confidence?: 'high' | 'moderate' | 'low';
  action_recommended?: string;
  urgency?: 'urgent' | 'soon' | 'routine' | 'informational';
}): string {
  const insightId = nanoid();

  insertWithEvent(
    'biomarker_insights',
    {
      id: insightId,
      lab_panel_id: panelId,
      insight_type: insight.insight_type,
      category: insight.category,
      title: insight.title,
      summary: insight.summary,
      details: insight.details ?? null,
      related_markers: insight.related_markers ? JSON.stringify(insight.related_markers) : null,
      confidence: insight.confidence ?? 'moderate',
      action_recommended: insight.action_recommended ?? null,
      urgency: insight.urgency ?? 'routine',
      status: 'active',
    },
    { source: 'bloodwork_import' }
  );

  return insightId;
}

// Run if called directly
if (import.meta.url === `file://${process.argv[1]}`) {
  const dbPath = process.env.DATABASE_PATH ?? './data/coach.db';
  initializeDb(dbPath);

  const jsonFile = process.argv[2];
  if (!jsonFile) {
    console.log('Usage: npx tsx scripts/import-bloodwork.ts <json-file>');
    console.log('');
    console.log('Or use import-april-2025-bloodwork.ts for the specific import.');
    closeDb();
    process.exit(1);
  }

  const { readFileSync } = await import('fs');
  const data = JSON.parse(readFileSync(jsonFile, 'utf-8')) as LabPanelInput | LabPanelInput[];

  const panels = Array.isArray(data) ? data : [data];
  for (const panel of panels) {
    importLabPanel(panel);
  }

  closeDb();
  console.log('Done!');
}
