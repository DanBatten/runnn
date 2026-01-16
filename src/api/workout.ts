/**
 * Workout API - Get workout recommendations and history
 *
 * Provides today's workout and historical workout data.
 */

import {
  ApiEnvelope,
  TodayWorkoutResult,
  WorkoutHistoryResult,
  WorkoutSummary,
  generateTraceId,
  success,
  timeOperation,
} from './types.js';
import { loadContext } from '../coach/context.js';
import { getActivePolicies } from '../policy/loader.js';
import { evaluatePolicies } from '../policy/engine.js';
import { query, queryOne } from '../db/client.js';
import { getReadiness } from './readiness.js';
import { recordDecision } from './decisions.js';

/**
 * Get today's recommended workout
 */
export async function getTodayWorkout(date?: string): Promise<ApiEnvelope<TodayWorkoutResult>> {
  const trace_id = generateTraceId();

  return timeOperation(trace_id, async () => {
    const context = loadContext(date);
    const today = context.today;

    // Get readiness first
    const readinessResult = await getReadiness(date);
    const readinessStatus = readinessResult.ok
      ? readinessResult.data?.status ?? 'unknown'
      : 'unknown';

    // Get planned workout
    const planned = context.planned_workout;

    // Evaluate policies to determine modifications
    const policies = getActivePolicies();
    const policyContext = buildPolicyContext(context, readinessStatus);
    const policyResults = evaluatePolicies(policies, policyContext);
    const triggeredPolicies = policyResults.filter(r => r.triggered);

    // Determine modifications
    const modifications: string[] = [];
    const policiesApplied: string[] = [];

    for (const result of triggeredPolicies) {
      policiesApplied.push(result.policy_id);

      for (const action of result.recommended_actions) {
        switch (action.type) {
          case 'skip_workout':
            modifications.push('Skip workout');
            break;
          case 'convert_workout':
            modifications.push('Convert to easy run');
            break;
          case 'reduce_volume':
            modifications.push(`Reduce volume by ${action.params?.percent ?? 20}%`);
            break;
          case 'reduce_intensity':
            modifications.push('Reduce intensity');
            break;
          case 'add_rest_day':
            modifications.push('Consider rest day');
            break;
        }
      }
    }

    // Generate rationale
    let rationale = planned?.rationale ?? null;
    if (modifications.length > 0) {
      rationale = `${rationale ? rationale + ' ' : ''}Modifications: ${modifications.join('; ')}.`;
    }

    // Record this as a decision for audit
    let decisionId: string | null = null;
    if (planned) {
      const decision = await recordDecision(
        'today_workout',
        {
          date: today,
          readiness_status: readinessStatus,
          planned_type: planned.type,
          planned_distance: planned.target_distance_meters,
        },
        {
          workout_type: planned.type,
          modifications,
          prescription: planned.prescription,
        },
        policiesApplied,
        trace_id
      );
      decisionId = decision.id;
    }

    return success<TodayWorkoutResult>(
      {
        date: today,
        has_planned_workout: planned !== null,
        workout_type: planned?.type ?? null,
        prescription: planned?.prescription ?? null,
        target_distance_meters: planned?.target_distance_meters ?? null,
        target_duration_seconds: planned?.target_duration_seconds ?? null,
        rationale,
        readiness_status: readinessStatus,
        modifications,
        policies_applied: policiesApplied,
        decision_id: decisionId,
      },
      trace_id
    );
  });
}

/**
 * Get workout history with filters
 */
export async function getWorkoutHistory(params: {
  days?: number;
  type?: string;
  limit?: number;
  offset?: number;
}): Promise<ApiEnvelope<WorkoutHistoryResult>> {
  const trace_id = generateTraceId();

  return timeOperation(trace_id, async () => {
    const days = params.days ?? 30;
    const limit = params.limit ?? 100;
    const offset = params.offset ?? 0;

    // Calculate date range
    const endDate = new Date().toISOString().split('T')[0];
    const startDate = subtractDays(endDate, days);

    // Build query
    const conditions: string[] = ['local_date >= ?'];
    const queryParams: unknown[] = [startDate];

    if (params.type) {
      conditions.push('type = ?');
      queryParams.push(params.type);
    }

    const whereClause = conditions.join(' AND ');

    // Get total count
    const countResult = queryOne<{ count: number }>(
      `SELECT COUNT(*) as count FROM workouts WHERE ${whereClause}`,
      queryParams
    );
    const totalCount = countResult?.count ?? 0;

    // Get workouts
    const rows = query<{
      id: string;
      local_date: string;
      type: string | null;
      distance_meters: number | null;
      duration_seconds: number | null;
      avg_pace_sec_per_mile: number | null;
      avg_hr: number | null;
      perceived_exertion: number | null;
    }>(
      `SELECT id, local_date, type, distance_meters, duration_seconds,
              avg_pace_sec_per_mile, avg_hr, perceived_exertion
       FROM workouts
       WHERE ${whereClause}
       ORDER BY local_date DESC
       LIMIT ? OFFSET ?`,
      [...queryParams, limit, offset]
    );

    const workouts: WorkoutSummary[] = rows.map(r => ({
      id: r.id,
      date: r.local_date,
      type: r.type,
      distance_meters: r.distance_meters,
      duration_seconds: r.duration_seconds,
      avg_pace_sec_per_mile: r.avg_pace_sec_per_mile,
      avg_hr: r.avg_hr,
      perceived_exertion: r.perceived_exertion,
    }));

    // Calculate totals
    const totalsResult = queryOne<{
      total_distance: number;
      total_duration: number;
    }>(
      `SELECT COALESCE(SUM(distance_meters), 0) as total_distance,
              COALESCE(SUM(duration_seconds), 0) as total_duration
       FROM workouts
       WHERE ${whereClause}`,
      queryParams
    );

    return success<WorkoutHistoryResult>(
      {
        workouts,
        total_count: totalCount,
        total_distance_meters: totalsResult?.total_distance ?? 0,
        total_duration_seconds: totalsResult?.total_duration ?? 0,
      },
      trace_id
    );
  });
}

/**
 * Build policy context for workout evaluation
 */
function buildPolicyContext(
  context: ReturnType<typeof loadContext>,
  readinessStatus: string
): Record<string, unknown> {
  return {
    sleep_hours: context.current_health?.sleep_hours,
    hrv: context.current_health?.hrv,
    rhr: context.current_health?.resting_hr,
    body_battery: context.current_health?.body_battery,
    hrv_delta_pct: context.readiness_deltas.hrv_delta_pct,
    weekly_mileage: context.weekly_mileage,
    weekly_ramp_pct: context.weekly_ramp_pct,
    planned_workout_type: context.planned_workout?.type,
    active_injury_severity: context.active_injury?.severity,
    travel_days_ago: context.travel_days_ago,
    active_overrides: context.override_names,
    readiness_status: readinessStatus,
  };
}

/**
 * Subtract days from a date string
 */
function subtractDays(date: string, days: number): string {
  const d = new Date(date);
  d.setDate(d.getDate() - days);
  return d.toISOString().split('T')[0];
}
