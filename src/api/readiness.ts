/**
 * Readiness API - Get readiness assessments and athlete context
 *
 * Wraps coach/context.ts with the API envelope contract.
 */

import {
  ApiEnvelope,
  ReadinessResult,
  AthleteContextResult,
  InjurySummary,
  PatternSummary,
  generateTraceId,
  success,
  timeOperation,
} from './types.js';
import { loadContext, type CoachContext } from '../coach/context.js';
import { getActivePolicies } from '../policy/loader.js';
import { evaluatePolicies } from '../policy/engine.js';
import { query } from '../db/client.js';

/**
 * Get today's readiness assessment
 */
export async function getReadiness(date?: string): Promise<ApiEnvelope<ReadinessResult>> {
  const trace_id = generateTraceId();

  return timeOperation(trace_id, async () => {
    const context = loadContext(date);

    // Determine status based on HRV and other metrics
    const status = determineReadinessStatus(context);

    // Get policy recommendations for readiness
    const policies = getActivePolicies();
    const policyContext = contextToPolicyContext(context);
    const policyResults = evaluatePolicies(policies, policyContext);

    // Find recommendation from triggered policies
    const triggeredPolicies = policyResults.filter(r => r.triggered);
    const recommendation = generateReadinessRecommendation(status, triggeredPolicies, context);

    return success<ReadinessResult>(
      {
        date: context.today,
        hrv: context.current_health?.hrv ?? null,
        rhr: context.current_health?.resting_hr ?? null,
        sleep_hours: context.current_health?.sleep_hours ?? null,
        body_battery: context.current_health?.body_battery ?? null,
        status,
        recommendation,
        policies_applied: triggeredPolicies.map(p => p.policy_id),
      },
      trace_id
    );
  });
}

/**
 * Get comprehensive athlete context
 */
export async function getAthleteContext(date?: string): Promise<ApiEnvelope<AthleteContextResult>> {
  const trace_id = generateTraceId();

  return timeOperation(trace_id, async () => {
    const context = loadContext(date);

    // Get readiness
    const status = determineReadinessStatus(context);
    const policies = getActivePolicies();
    const policyContext = contextToPolicyContext(context);
    const policyResults = evaluatePolicies(policies, policyContext);
    const triggeredPolicies = policyResults.filter(r => r.triggered);
    const recommendation = generateReadinessRecommendation(status, triggeredPolicies, context);

    // Get active patterns
    const patterns = getActivePatterns();

    // Build injury summary
    const activeInjury: InjurySummary | null = context.active_injury
      ? {
          location: context.active_injury.location,
          severity: context.active_injury.severity,
          trend: context.active_injury.trend,
          limits_running: context.active_injury.limits_running === 1,
        }
      : null;

    return success<AthleteContextResult>(
      {
        today: context.today,
        readiness: {
          date: context.today,
          hrv: context.current_health?.hrv ?? null,
          rhr: context.current_health?.resting_hr ?? null,
          sleep_hours: context.current_health?.sleep_hours ?? null,
          body_battery: context.current_health?.body_battery ?? null,
          status,
          recommendation,
          policies_applied: triggeredPolicies.map(p => p.policy_id),
        },
        weekly_mileage: context.weekly_mileage,
        weekly_mileage_prev: context.weekly_mileage_prev,
        weekly_ramp_pct: context.weekly_ramp_pct,
        recent_workout_count: context.recent_workouts.length,
        active_injury: activeInjury,
        active_overrides: context.override_names,
        active_patterns: patterns,
      },
      trace_id
    );
  });
}

/**
 * Determine readiness status from health metrics
 */
function determineReadinessStatus(
  context: CoachContext
): ReadinessResult['status'] {
  const health = context.current_health;
  const baseline = context.readiness_baseline;

  if (!health || health.hrv === null) {
    return 'unknown';
  }

  const hrv = health.hrv;

  // Use 7-day baseline if available
  const hrvBaseline = baseline?.hrv_7day_avg ?? 50;

  // Calculate percentage of baseline
  const hrvPct = (hrv / hrvBaseline) * 100;

  if (hrvPct < 80) {
    return 'compromised';
  } else if (hrvPct < 95) {
    return 'below_baseline';
  } else if (hrvPct <= 110) {
    return 'normal';
  } else {
    return 'elevated';
  }
}

/**
 * Generate readiness recommendation based on status and policies
 */
function generateReadinessRecommendation(
  status: ReadinessResult['status'],
  triggeredPolicies: Array<{ policy_name: string; recommended_actions: Array<{ type: string }> }>,
  context: CoachContext
): string {
  const parts: string[] = [];

  // Status-based recommendation
  switch (status) {
    case 'compromised':
      parts.push('Recovery day recommended. HRV significantly below baseline.');
      break;
    case 'below_baseline':
      parts.push('Easy day preferred. HRV below baseline.');
      break;
    case 'normal':
      parts.push('Ready for planned training.');
      break;
    case 'elevated':
      parts.push('Good recovery. Quality session appropriate.');
      break;
    case 'unknown':
      parts.push('Insufficient data for assessment.');
      break;
  }

  // Add policy-triggered modifications
  const modifications = triggeredPolicies.flatMap(p =>
    p.recommended_actions.map(a => a.type)
  );

  if (modifications.includes('skip_workout')) {
    parts.push('Policy suggests skipping today\'s workout.');
  }
  if (modifications.includes('convert_workout')) {
    parts.push('Consider converting quality to easy.');
  }
  if (modifications.includes('reduce_volume')) {
    parts.push('Reduce planned volume.');
  }

  // Add injury context
  if (context.active_injury) {
    parts.push(`Active injury: ${context.active_injury.location} (${context.active_injury.severity}/10).`);
  }

  // Add travel context
  if (context.travel_days_ago !== null && context.travel_days_ago <= 3) {
    parts.push(`Recent travel (${context.travel_days_ago}d ago). Allow extra recovery.`);
  }

  return parts.join(' ');
}

/**
 * Get active patterns from database
 */
function getActivePatterns(): PatternSummary[] {
  try {
    const rows = query<{
      id: string;
      name: string;
      status: string;
      confidence: number;
      description: string;
    }>(
      `SELECT id, name, status, confidence, description
       FROM patterns
       WHERE status = 'active'
       ORDER BY confidence DESC
       LIMIT 10`
    );

    return rows.map(r => ({
      id: r.id,
      name: r.name,
      status: r.status as PatternSummary['status'],
      confidence: r.confidence,
      description: r.description,
    }));
  } catch {
    return [];
  }
}

/**
 * Convert CoachContext to PolicyContext for evaluation
 */
function contextToPolicyContext(context: CoachContext): Record<string, unknown> {
  return {
    sleep_hours: context.current_health?.sleep_hours,
    sleep_quality: context.current_health?.sleep_quality,
    hrv: context.current_health?.hrv,
    hrv_status: context.current_health?.hrv_status,
    rhr: context.current_health?.resting_hr,
    body_battery: context.current_health?.body_battery,
    hrv_delta_pct: context.readiness_deltas.hrv_delta_pct,
    rhr_delta_pct: context.readiness_deltas.rhr_delta_pct,
    sleep_delta_pct: context.readiness_deltas.sleep_delta_pct,
    weekly_mileage: context.weekly_mileage,
    weekly_mileage_prev: context.weekly_mileage_prev,
    weekly_ramp_pct: context.weekly_ramp_pct,
    planned_workout_type: context.planned_workout?.type,
    active_injury_severity: context.active_injury?.severity,
    active_injury_location: context.active_injury?.location,
    injury_trend: context.active_injury?.trend,
    travel_days_ago: context.travel_days_ago,
    timezone_change_hours: context.timezone_change_hours,
    active_overrides: context.override_names,
  };
}
