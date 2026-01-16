/**
 * API Types - Core contracts for the deterministic execution layer
 *
 * All API functions return an ApiEnvelope for observability and consistency.
 * Write operations support idempotency and dry_run modes.
 */

import { nanoid } from 'nanoid';

/**
 * Standard response envelope for all API operations
 */
export interface ApiEnvelope<T> {
  ok: boolean;
  data?: T;
  error?: ApiError;
  trace_id: string;
  timings_ms?: {
    total: number;
    db?: number;
    external?: number;
  };
  /** True if result was returned from idempotency cache */
  cached?: boolean;
  /** True if this was a dry_run (no mutations occurred) */
  dry_run?: boolean;
}

/**
 * Structured error for API responses
 */
export interface ApiError {
  code: string;
  message: string;
  details?: unknown;
}

/**
 * Common parameters for write operations
 */
export interface WriteParams {
  /** Dedupe key - if provided and already processed, returns cached result */
  idempotency_key?: string;
  /** Preview mode - returns what would happen without making changes */
  dry_run?: boolean;
}

/**
 * First-class decision record
 * Every recommendation persists inputs + policies + output for reproducibility
 */
export interface DecisionRecord {
  id: string;
  created_at: string;
  decision_type: string;
  inputs: Record<string, unknown>;
  policy_versions: string[];
  output: unknown;
  explanation_id?: string;
  trace_id: string;
}

/**
 * Lock record for concurrency control
 */
export interface Lock {
  operation: string;
  trace_id: string;
  acquired_at: number;
}

/**
 * Idempotency record
 */
export interface IdempotencyRecord {
  key: string;
  result_json: string;
  created_at: string;
  expires_at: string;
}

// ============================================
// Helper Functions
// ============================================

/**
 * Generate a unique trace ID for request tracking
 */
export function generateTraceId(): string {
  return `trc_${nanoid(16)}`;
}

/**
 * Generate a unique ID with optional prefix
 */
export function generateId(prefix?: string): string {
  const id = nanoid(12);
  return prefix ? `${prefix}_${id}` : id;
}

/**
 * Create a success envelope
 */
export function success<T>(data: T, trace_id: string, options?: {
  timings_ms?: ApiEnvelope<T>['timings_ms'];
  cached?: boolean;
  dry_run?: boolean;
}): ApiEnvelope<T> {
  return {
    ok: true,
    data,
    trace_id,
    ...options,
  };
}

/**
 * Create an error envelope
 */
export function failure<T = never>(
  code: string,
  message: string,
  trace_id: string,
  details?: unknown
): ApiEnvelope<T> {
  return {
    ok: false,
    error: { code, message, details },
    trace_id,
  };
}

/**
 * Wrap an async operation with timing
 */
export async function timeOperation<T>(
  trace_id: string,
  operation: () => Promise<ApiEnvelope<T>>
): Promise<ApiEnvelope<T>> {
  const startTime = Date.now();

  try {
    const result = await operation();
    const totalTime = Date.now() - startTime;

    return {
      ...result,
      timings_ms: {
        ...result.timings_ms,
        total: totalTime,
      },
    };
  } catch (err) {
    const totalTime = Date.now() - startTime;
    const message = err instanceof Error ? err.message : 'Unknown error';

    return {
      ok: false,
      error: {
        code: 'INTERNAL_ERROR',
        message,
        details: err instanceof Error ? { stack: err.stack } : undefined,
      },
      trace_id,
      timings_ms: { total: totalTime },
    };
  }
}

/**
 * Wrap a sync operation with error handling
 */
export function safeOperation<T>(
  trace_id: string,
  operation: () => T
): ApiEnvelope<T> {
  const startTime = Date.now();

  try {
    const data = operation();
    return {
      ok: true,
      data,
      trace_id,
      timings_ms: { total: Date.now() - startTime },
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return {
      ok: false,
      error: {
        code: 'INTERNAL_ERROR',
        message,
        details: err instanceof Error ? { stack: err.stack } : undefined,
      },
      trace_id,
      timings_ms: { total: Date.now() - startTime },
    };
  }
}

// ============================================
// Common Result Types
// ============================================

/**
 * Readiness assessment result
 */
export interface ReadinessResult {
  date: string;
  hrv: number | null;
  rhr: number | null;
  sleep_hours: number | null;
  body_battery: number | null;
  status: 'compromised' | 'below_baseline' | 'normal' | 'elevated' | 'unknown';
  recommendation: string;
  policies_applied: string[];
}

/**
 * Today's workout result
 */
export interface TodayWorkoutResult {
  date: string;
  has_planned_workout: boolean;
  workout_type: string | null;
  prescription: string | null;
  target_distance_meters: number | null;
  target_duration_seconds: number | null;
  rationale: string | null;
  readiness_status: string;
  modifications: string[];
  policies_applied: string[];
  decision_id: string | null;
}

/**
 * Workout history query result
 */
export interface WorkoutHistoryResult {
  workouts: WorkoutSummary[];
  total_count: number;
  total_distance_meters: number;
  total_duration_seconds: number;
}

/**
 * Summary of a single workout
 */
export interface WorkoutSummary {
  id: string;
  date: string;
  type: string | null;
  distance_meters: number | null;
  duration_seconds: number | null;
  avg_pace_sec_per_mile: number | null;
  avg_hr: number | null;
  perceived_exertion: number | null;
}

/**
 * Sync operation result
 */
export interface SyncResult {
  garmin: {
    activities: number;
    health_snapshots: number;
  };
  notes: {
    processed: number;
    matched: number;
  };
  events_created: number;
}

/**
 * Doctor/data quality result
 */
export interface DoctorResult {
  schema_valid: boolean;
  issues_found: number;
  issues_fixed: number;
  issues_by_type: Record<string, number>;
  has_blocking_errors: boolean;
  details: DoctorIssue[];
}

/**
 * Individual data quality issue
 */
export interface DoctorIssue {
  id: string;
  type: string;
  severity: 'critical' | 'error' | 'warning';
  description: string;
  suggested_fix: string | null;
  fixed: boolean;
}

/**
 * Policy list result
 */
export interface PolicyListResult {
  policies: PolicySummary[];
  total_count: number;
  active_count: number;
}

/**
 * Summary of a single policy
 */
export interface PolicySummary {
  id: string;
  name: string;
  version: string;
  description: string;
  is_active: boolean;
  priority: number;
}

/**
 * Policy evaluation result
 */
export interface PolicyEvalResult {
  policy_id: string;
  policy_name: string;
  triggered: boolean;
  conditions_met: string[];
  conditions_not_met: string[];
  recommended_actions: string[];
  explanation: string;
}

/**
 * Events list result
 */
export interface EventsResult {
  events: EventSummary[];
  total_count: number;
}

/**
 * Summary of a single event
 */
export interface EventSummary {
  id: string;
  timestamp: string;
  entity_type: string;
  entity_id: string;
  action: string;
  source: string;
  reason: string | null;
}

/**
 * Athlete context result (comprehensive)
 */
export interface AthleteContextResult {
  today: string;
  readiness: ReadinessResult;
  weekly_mileage: number;
  weekly_mileage_prev: number;
  weekly_ramp_pct: number | null;
  recent_workout_count: number;
  active_injury: InjurySummary | null;
  active_overrides: string[];
  active_patterns: PatternSummary[];
}

/**
 * Injury summary
 */
export interface InjurySummary {
  location: string;
  severity: number;
  trend: string | null;
  limits_running: boolean;
}

/**
 * Pattern summary
 */
export interface PatternSummary {
  id: string;
  name: string;
  status: 'candidate' | 'active' | 'retired';
  confidence: number;
  description: string;
}

/**
 * Decision explanation result
 */
export interface DecisionExplanation {
  decision_id: string;
  decision_type: string;
  created_at: string;
  inputs_summary: string;
  policies_summary: string;
  output_summary: string;
  full_explanation: string;
}
