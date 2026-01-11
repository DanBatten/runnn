/**
 * Predictions - Generate and track workout predictions
 *
 * When recommending a workout, predict:
 * - Expected RPE range
 * - Expected HR drift
 * - Expected pace range
 * - Expected next-day readiness impact
 *
 * Compare predictions to reality → measure accuracy → improve
 */

import { query, queryOne, generateId, insertWithEvent, updateWithEvent } from '../db/client.js';
import { getCurrentPaceZones, getPaceRangeForWorkout } from './pace-zones.js';
import { loadContext, toPolicyContext } from './context.js';

export interface WorkoutPrediction {
  id: string;
  workout_id: string | null;
  planned_workout_id: string | null;
  prediction_date: string;

  // RPE prediction
  predicted_rpe_low: number;
  predicted_rpe_high: number;
  actual_rpe: number | null;

  // Pace prediction (sec/mile)
  predicted_pace_low: number | null;
  predicted_pace_high: number | null;
  actual_pace: number | null;

  // HR prediction
  predicted_hr_avg: number | null;
  predicted_hr_drift_pct: number | null;
  actual_hr_avg: number | null;
  actual_hr_drift_pct: number | null;

  // Next-day impact
  predicted_hrv_impact_pct: number | null;
  predicted_fatigue_increase: number | null;
  actual_hrv_change_pct: number | null;

  // Confidence and evaluation
  confidence: number;
  evaluated_at: string | null;
  accuracy_score: number | null;

  context_summary: string | null;
  notes: string | null;
  created_at: string;
}

interface PredictionRow {
  id: string;
  workout_id: string | null;
  planned_workout_id: string | null;
  prediction_date: string;
  predicted_rpe_low: number;
  predicted_rpe_high: number;
  actual_rpe: number | null;
  predicted_pace_low: number | null;
  predicted_pace_high: number | null;
  actual_pace: number | null;
  predicted_hr_avg: number | null;
  predicted_hr_drift_pct: number | null;
  actual_hr_avg: number | null;
  actual_hr_drift_pct: number | null;
  predicted_hrv_impact_pct: number | null;
  predicted_fatigue_increase: number | null;
  actual_hrv_change_pct: number | null;
  confidence: number;
  evaluated_at: string | null;
  accuracy_score: number | null;
  context_summary: string | null;
  notes: string | null;
  created_at: string;
}

// We need to create this table - it's not in the original schema
const CREATE_PREDICTIONS_TABLE = `
CREATE TABLE IF NOT EXISTS workout_predictions (
  id TEXT PRIMARY KEY,
  workout_id TEXT REFERENCES workouts(id),
  planned_workout_id TEXT REFERENCES planned_workouts(id),
  prediction_date TEXT NOT NULL,
  predicted_rpe_low INTEGER NOT NULL,
  predicted_rpe_high INTEGER NOT NULL,
  actual_rpe INTEGER,
  predicted_pace_low REAL,
  predicted_pace_high REAL,
  actual_pace REAL,
  predicted_hr_avg INTEGER,
  predicted_hr_drift_pct REAL,
  actual_hr_avg INTEGER,
  actual_hr_drift_pct REAL,
  predicted_hrv_impact_pct REAL,
  predicted_fatigue_increase REAL,
  actual_hrv_change_pct REAL,
  confidence REAL DEFAULT 0.5,
  evaluated_at TEXT,
  accuracy_score REAL,
  context_summary TEXT,
  notes TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS predictions_workout_idx ON workout_predictions(workout_id);
CREATE INDEX IF NOT EXISTS predictions_date_idx ON workout_predictions(prediction_date);
`;

/**
 * Ensure predictions table exists
 */
export function ensurePredictionsTable(): void {
  const { execute } = require('../db/client.js');
  execute(CREATE_PREDICTIONS_TABLE);
}

/**
 * Generate a prediction for a workout
 */
export function generatePrediction(
  workoutType: string,
  options?: {
    planned_workout_id?: string;
    target_distance_meters?: number;
    target_duration_seconds?: number;
    date?: string;
  }
): WorkoutPrediction {
  const date = options?.date ?? new Date().toISOString().split('T')[0];
  const context = loadContext(date);
  const policyContext = toPolicyContext(context);
  const paceZones = getCurrentPaceZones();

  // Base RPE prediction based on workout type
  let baseRpeLow = 4;
  let baseRpeHigh = 5;

  switch (workoutType.toLowerCase()) {
    case 'easy':
    case 'recovery':
      baseRpeLow = 3;
      baseRpeHigh = 4;
      break;
    case 'steady':
    case 'aerobic':
      baseRpeLow = 4;
      baseRpeHigh = 5;
      break;
    case 'tempo':
      baseRpeLow = 6;
      baseRpeHigh = 7;
      break;
    case 'threshold':
      baseRpeLow = 7;
      baseRpeHigh = 8;
      break;
    case 'interval':
      baseRpeLow = 8;
      baseRpeHigh = 9;
      break;
    case 'long':
      baseRpeLow = 5;
      baseRpeHigh = 7;
      break;
    case 'race':
      baseRpeLow = 9;
      baseRpeHigh = 10;
      break;
  }

  // Adjust RPE based on readiness
  let rpeAdjustment = 0;

  if (policyContext.sleep_hours !== undefined && policyContext.sleep_hours < 6) {
    rpeAdjustment += 1;
  }
  if (policyContext.hrv_delta_pct !== undefined && policyContext.hrv_delta_pct < -10) {
    rpeAdjustment += 0.5;
  }
  if (policyContext.rhr_delta_pct !== undefined && policyContext.rhr_delta_pct > 5) {
    rpeAdjustment += 0.5;
  }
  if (policyContext.consecutive_hard_days !== undefined && policyContext.consecutive_hard_days >= 2) {
    rpeAdjustment += 0.5;
  }

  const predictedRpeLow = Math.min(10, Math.round(baseRpeLow + rpeAdjustment));
  const predictedRpeHigh = Math.min(10, Math.round(baseRpeHigh + rpeAdjustment));

  // Pace prediction from zones
  let predictedPaceLow: number | null = null;
  let predictedPaceHigh: number | null = null;

  if (paceZones) {
    const paceRange = getPaceRangeForWorkout(paceZones, workoutType);
    if (paceRange) {
      predictedPaceLow = paceRange.low;
      predictedPaceHigh = paceRange.high;
    }
  }

  // HR prediction (simplified)
  let predictedHrAvg: number | null = null;
  let predictedHrDrift: number | null = null;

  if (paceZones?.easy_hr_low && paceZones?.threshold_hr) {
    switch (workoutType.toLowerCase()) {
      case 'easy':
      case 'recovery':
        predictedHrAvg = Math.round((paceZones.easy_hr_low + paceZones.easy_hr_high!) / 2);
        predictedHrDrift = 3; // Low drift for easy
        break;
      case 'tempo':
        predictedHrAvg = Math.round((paceZones.tempo_hr_low! + paceZones.tempo_hr_high!) / 2);
        predictedHrDrift = 5;
        break;
      case 'threshold':
      case 'interval':
        predictedHrAvg = paceZones.threshold_hr;
        predictedHrDrift = 8;
        break;
      case 'long':
        predictedHrAvg = Math.round(paceZones.easy_hr_high! * 1.05);
        predictedHrDrift = 8; // Higher drift for long runs
        break;
    }
  }

  // Next-day impact prediction
  let predictedHrvImpact: number | null = null;
  let predictedFatigueIncrease: number | null = null;

  switch (workoutType.toLowerCase()) {
    case 'easy':
    case 'recovery':
      predictedHrvImpact = 0;
      predictedFatigueIncrease = 1;
      break;
    case 'steady':
      predictedHrvImpact = -3;
      predictedFatigueIncrease = 2;
      break;
    case 'tempo':
      predictedHrvImpact = -5;
      predictedFatigueIncrease = 3;
      break;
    case 'threshold':
    case 'interval':
      predictedHrvImpact = -8;
      predictedFatigueIncrease = 4;
      break;
    case 'long':
      predictedHrvImpact = -10;
      predictedFatigueIncrease = 4;
      break;
    case 'race':
      predictedHrvImpact = -15;
      predictedFatigueIncrease = 5;
      break;
  }

  // Calculate confidence based on data availability
  let confidence = 0.5;
  if (context.current_health) confidence += 0.1;
  if (context.readiness_baseline) confidence += 0.1;
  if (paceZones) confidence += 0.15;
  if (context.recent_workouts.length >= 7) confidence += 0.1;
  confidence = Math.min(0.95, confidence);

  // Create context summary
  const contextSummary = [
    context.current_health?.sleep_hours ? `sleep: ${context.current_health.sleep_hours}hr` : null,
    context.readiness_deltas.hrv_delta_pct !== null
      ? `HRV: ${context.readiness_deltas.hrv_delta_pct > 0 ? '+' : ''}${context.readiness_deltas.hrv_delta_pct.toFixed(0)}%`
      : null,
    `weekly: ${(context.weekly_mileage / 1609.344).toFixed(1)}mi`,
  ].filter(Boolean).join(' | ');

  return {
    id: generateId(),
    workout_id: null,
    planned_workout_id: options?.planned_workout_id ?? null,
    prediction_date: date,
    predicted_rpe_low: predictedRpeLow,
    predicted_rpe_high: predictedRpeHigh,
    actual_rpe: null,
    predicted_pace_low: predictedPaceLow,
    predicted_pace_high: predictedPaceHigh,
    actual_pace: null,
    predicted_hr_avg: predictedHrAvg,
    predicted_hr_drift_pct: predictedHrDrift,
    actual_hr_avg: null,
    actual_hr_drift_pct: null,
    predicted_hrv_impact_pct: predictedHrvImpact,
    predicted_fatigue_increase: predictedFatigueIncrease,
    actual_hrv_change_pct: null,
    confidence,
    evaluated_at: null,
    accuracy_score: null,
    context_summary: contextSummary,
    notes: null,
    created_at: new Date().toISOString(),
  };
}

/**
 * Save a prediction to database
 */
export function savePrediction(prediction: WorkoutPrediction): string {
  ensurePredictionsTable();

  insertWithEvent(
    'workout_predictions',
    {
      id: prediction.id,
      workout_id: prediction.workout_id,
      planned_workout_id: prediction.planned_workout_id,
      prediction_date: prediction.prediction_date,
      predicted_rpe_low: prediction.predicted_rpe_low,
      predicted_rpe_high: prediction.predicted_rpe_high,
      actual_rpe: prediction.actual_rpe,
      predicted_pace_low: prediction.predicted_pace_low,
      predicted_pace_high: prediction.predicted_pace_high,
      actual_pace: prediction.actual_pace,
      predicted_hr_avg: prediction.predicted_hr_avg,
      predicted_hr_drift_pct: prediction.predicted_hr_drift_pct,
      actual_hr_avg: prediction.actual_hr_avg,
      actual_hr_drift_pct: prediction.actual_hr_drift_pct,
      predicted_hrv_impact_pct: prediction.predicted_hrv_impact_pct,
      predicted_fatigue_increase: prediction.predicted_fatigue_increase,
      actual_hrv_change_pct: prediction.actual_hrv_change_pct,
      confidence: prediction.confidence,
      evaluated_at: prediction.evaluated_at,
      accuracy_score: prediction.accuracy_score,
      context_summary: prediction.context_summary,
      notes: prediction.notes,
    },
    { source: 'prediction_create' }
  );

  return prediction.id;
}

/**
 * Get prediction by ID
 */
export function getPredictionById(id: string): WorkoutPrediction | null {
  ensurePredictionsTable();
  const row = queryOne<PredictionRow>(
    'SELECT * FROM workout_predictions WHERE id = ?',
    [id]
  );

  return row ? parsePredictionRow(row) : null;
}

/**
 * Get prediction for a workout
 */
export function getPredictionForWorkout(workoutId: string): WorkoutPrediction | null {
  ensurePredictionsTable();
  const row = queryOne<PredictionRow>(
    'SELECT * FROM workout_predictions WHERE workout_id = ?',
    [workoutId]
  );

  return row ? parsePredictionRow(row) : null;
}

/**
 * Get unevaluated predictions
 */
export function getUnevaluatedPredictions(): WorkoutPrediction[] {
  ensurePredictionsTable();
  const rows = query<PredictionRow>(
    `SELECT * FROM workout_predictions
     WHERE evaluated_at IS NULL AND workout_id IS NOT NULL
     ORDER BY prediction_date DESC`
  );

  return rows.map(parsePredictionRow);
}

/**
 * Link prediction to completed workout
 */
export function linkPredictionToWorkout(predictionId: string, workoutId: string): void {
  ensurePredictionsTable();
  updateWithEvent(
    'workout_predictions',
    predictionId,
    { workout_id: workoutId },
    { source: 'prediction_link' }
  );
}

/**
 * Record actual results and evaluate prediction
 */
export function evaluatePrediction(
  predictionId: string,
  actuals: {
    rpe?: number;
    pace?: number;
    hr_avg?: number;
    hr_drift_pct?: number;
    next_day_hrv_change_pct?: number;
  }
): number {
  ensurePredictionsTable();
  const prediction = getPredictionById(predictionId);
  if (!prediction) return 0;

  // Calculate accuracy score (0-1)
  let totalScore = 0;
  let scoredMetrics = 0;

  // RPE accuracy
  if (actuals.rpe !== undefined) {
    const rpeInRange = actuals.rpe >= prediction.predicted_rpe_low &&
                       actuals.rpe <= prediction.predicted_rpe_high;
    const rpeScore = rpeInRange ? 1 : Math.max(0, 1 - Math.abs(actuals.rpe - (prediction.predicted_rpe_low + prediction.predicted_rpe_high) / 2) / 5);
    totalScore += rpeScore;
    scoredMetrics++;
  }

  // Pace accuracy
  if (actuals.pace !== undefined && prediction.predicted_pace_low && prediction.predicted_pace_high) {
    const paceInRange = actuals.pace >= prediction.predicted_pace_low &&
                        actuals.pace <= prediction.predicted_pace_high;
    const targetPace = (prediction.predicted_pace_low + prediction.predicted_pace_high) / 2;
    const paceScore = paceInRange ? 1 : Math.max(0, 1 - Math.abs(actuals.pace - targetPace) / 60);
    totalScore += paceScore;
    scoredMetrics++;
  }

  // HR accuracy
  if (actuals.hr_avg !== undefined && prediction.predicted_hr_avg) {
    const hrDiff = Math.abs(actuals.hr_avg - prediction.predicted_hr_avg);
    const hrScore = Math.max(0, 1 - hrDiff / 20);
    totalScore += hrScore;
    scoredMetrics++;
  }

  const accuracyScore = scoredMetrics > 0 ? totalScore / scoredMetrics : 0.5;

  // Update prediction with actuals
  updateWithEvent(
    'workout_predictions',
    predictionId,
    {
      actual_rpe: actuals.rpe ?? null,
      actual_pace: actuals.pace ?? null,
      actual_hr_avg: actuals.hr_avg ?? null,
      actual_hr_drift_pct: actuals.hr_drift_pct ?? null,
      actual_hrv_change_pct: actuals.next_day_hrv_change_pct ?? null,
      evaluated_at: new Date().toISOString(),
      accuracy_score: accuracyScore,
    },
    { source: 'prediction_evaluate' }
  );

  return accuracyScore;
}

/**
 * Get prediction accuracy statistics
 */
export function getPredictionStats(daysBack: number = 30): {
  total_predictions: number;
  evaluated_predictions: number;
  avg_accuracy: number;
  avg_confidence: number;
  accuracy_by_workout_type: Record<string, number>;
} {
  ensurePredictionsTable();
  const cutoff = subtractDays(new Date().toISOString().split('T')[0], daysBack);

  const total = queryOne<{ count: number }>(
    'SELECT COUNT(*) as count FROM workout_predictions WHERE prediction_date >= ?',
    [cutoff]
  );

  const evaluated = queryOne<{ count: number; avg_accuracy: number; avg_confidence: number }>(
    `SELECT COUNT(*) as count, AVG(accuracy_score) as avg_accuracy, AVG(confidence) as avg_confidence
     FROM workout_predictions
     WHERE prediction_date >= ? AND evaluated_at IS NOT NULL`,
    [cutoff]
  );

  return {
    total_predictions: total?.count ?? 0,
    evaluated_predictions: evaluated?.count ?? 0,
    avg_accuracy: evaluated?.avg_accuracy ?? 0,
    avg_confidence: evaluated?.avg_confidence ?? 0,
    accuracy_by_workout_type: {}, // Would need to join with workouts to calculate
  };
}

/**
 * Format prediction for display
 */
export function formatPrediction(prediction: WorkoutPrediction): string {
  const lines: string[] = [
    `Prediction for ${prediction.prediction_date}`,
    `  RPE: ${prediction.predicted_rpe_low}-${prediction.predicted_rpe_high}`,
  ];

  if (prediction.predicted_pace_low && prediction.predicted_pace_high) {
    lines.push(`  Pace: ${formatPace(prediction.predicted_pace_high)}-${formatPace(prediction.predicted_pace_low)}/mi`);
  }

  if (prediction.predicted_hr_avg) {
    lines.push(`  HR: ~${prediction.predicted_hr_avg} bpm`);
  }

  if (prediction.predicted_hrv_impact_pct !== null) {
    lines.push(`  Next-day HRV impact: ${prediction.predicted_hrv_impact_pct}%`);
  }

  lines.push(`  Confidence: ${(prediction.confidence * 100).toFixed(0)}%`);

  if (prediction.accuracy_score !== null) {
    lines.push(`  Accuracy: ${(prediction.accuracy_score * 100).toFixed(0)}%`);
  }

  return lines.join('\n');
}

function formatPace(secPerMile: number): string {
  const mins = Math.floor(secPerMile / 60);
  const secs = Math.floor(secPerMile % 60);
  return `${mins}:${secs.toString().padStart(2, '0')}`;
}

function subtractDays(date: string, days: number): string {
  const d = new Date(date);
  d.setDate(d.getDate() - days);
  return d.toISOString().split('T')[0];
}

function parsePredictionRow(row: PredictionRow): WorkoutPrediction {
  return {
    id: row.id,
    workout_id: row.workout_id,
    planned_workout_id: row.planned_workout_id,
    prediction_date: row.prediction_date,
    predicted_rpe_low: row.predicted_rpe_low,
    predicted_rpe_high: row.predicted_rpe_high,
    actual_rpe: row.actual_rpe,
    predicted_pace_low: row.predicted_pace_low,
    predicted_pace_high: row.predicted_pace_high,
    actual_pace: row.actual_pace,
    predicted_hr_avg: row.predicted_hr_avg,
    predicted_hr_drift_pct: row.predicted_hr_drift_pct,
    actual_hr_avg: row.actual_hr_avg,
    actual_hr_drift_pct: row.actual_hr_drift_pct,
    predicted_hrv_impact_pct: row.predicted_hrv_impact_pct,
    predicted_fatigue_increase: row.predicted_fatigue_increase,
    actual_hrv_change_pct: row.actual_hrv_change_pct,
    confidence: row.confidence,
    evaluated_at: row.evaluated_at,
    accuracy_score: row.accuracy_score,
    context_summary: row.context_summary,
    notes: row.notes,
    created_at: row.created_at,
  };
}
