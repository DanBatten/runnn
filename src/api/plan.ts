/**
 * Plan API - Training plan creation and management
 *
 * Write operations that persist decision records for audit.
 */

import {
  ApiEnvelope,
  WriteParams,
  generateTraceId,
  success,
  timeOperation,
} from './types.js';
import { withWriteLock } from './concurrency.js';
import { recordDecision } from './decisions.js';
import { loadContext } from '../coach/context.js';
import { getActivePolicies } from '../policy/loader.js';
import { insertWithEvent } from '../db/client.js';

export interface PlanCreateParams extends WriteParams {
  goal_race?: string;
  goal_time?: string;
  weeks: number;
  weekly_mileage_target?: number;
  start_date?: string;
}

export interface PlanWeekParams extends WriteParams {
  week_start?: string;
}

export interface PlanResult {
  plan_id: string;
  weeks_planned: number;
  workouts_created: number;
  decision_id: string;
}

export interface WeekPlanResult {
  week_start: string;
  workouts_planned: number;
  total_distance_meters: number;
  decision_id: string;
  workouts: PlannedWorkoutSummary[];
}

export interface PlannedWorkoutSummary {
  id: string;
  date: string;
  type: string;
  target_distance_meters: number | null;
  prescription: string | null;
}

/**
 * Create a multi-week training plan
 */
export async function generatePlan(
  params: PlanCreateParams
): Promise<ApiEnvelope<PlanResult>> {
  const trace_id = generateTraceId();
  const { idempotency_key, dry_run = false } = params;

  return timeOperation(trace_id, async () => {
    // Get context for planning
    const context = loadContext(params.start_date);
    const policies = getActivePolicies();

    // Calculate plan parameters
    const startDate = params.start_date ?? getNextMonday();
    const weeklyTarget = params.weekly_mileage_target ?? estimateWeeklyTarget(context);

    // Dry run - preview what would be created
    if (dry_run) {
      const preview = previewPlan(params, weeklyTarget, context);
      return success<PlanResult>(preview, trace_id, { dry_run: true });
    }

    // Create plan with write lock
    const { result, cached } = await withWriteLock<PlanResult>(
      'plan_create',
      trace_id,
      idempotency_key,
      async () => {
        // Generate plan ID
        const planId = `plan_${Date.now()}`;
        let workoutsCreated = 0;

        // Create workouts for each week
        for (let week = 0; week < params.weeks; week++) {
          const weekStart = addDays(startDate, week * 7);
          const weekWorkouts = generateWeekWorkouts(
            weekStart,
            weeklyTarget,
            params.goal_race,
            week,
            params.weeks
          );

          for (const workout of weekWorkouts) {
            insertWithEvent(
              'planned_workouts',
              {
                ...workout,
                plan_id: planId,
              },
              {
                source: 'api',
                reason: `Plan creation: week ${week + 1}`,
              }
            );
            workoutsCreated++;
          }
        }

        // Record decision
        const decision = await recordDecision(
          'plan_create',
          {
            weeks: params.weeks,
            goal_race: params.goal_race,
            goal_time: params.goal_time,
            weekly_target: weeklyTarget,
            current_weekly_mileage: context.weekly_mileage,
          },
          {
            plan_id: planId,
            workouts_created: workoutsCreated,
          },
          policies.map(p => p.id),
          trace_id
        );

        return {
          plan_id: planId,
          weeks_planned: params.weeks,
          workouts_created: workoutsCreated,
          decision_id: decision.id,
        };
      }
    );

    return success<PlanResult>(result, trace_id, { cached });
  });
}

/**
 * Generate next week's workout schedule
 */
export async function generateWeeklyPlan(
  params: PlanWeekParams = {}
): Promise<ApiEnvelope<WeekPlanResult>> {
  const trace_id = generateTraceId();
  const { idempotency_key, dry_run = false } = params;

  return timeOperation(trace_id, async () => {
    const weekStart = params.week_start ?? getNextMonday();
    const context = loadContext(weekStart);
    const policies = getActivePolicies();

    // Calculate target based on current mileage and ramp limits
    const targetMileage = calculateSafeWeeklyTarget(context);

    // Dry run preview
    if (dry_run) {
      const workouts = generateWeekWorkouts(weekStart, targetMileage);
      return success<WeekPlanResult>(
        {
          week_start: weekStart,
          workouts_planned: workouts.length,
          total_distance_meters: workouts.reduce(
            (sum, w) => sum + (w.target_distance_meters ?? 0),
            0
          ),
          decision_id: 'dry_run',
          workouts: workouts.map(w => ({
            id: 'preview',
            date: w.local_date,
            type: w.type,
            target_distance_meters: w.target_distance_meters,
            prescription: w.prescription,
          })),
        },
        trace_id,
        { dry_run: true }
      );
    }

    // Create with write lock
    const { result, cached } = await withWriteLock<WeekPlanResult>(
      'plan_week',
      trace_id,
      idempotency_key,
      async () => {
        const workouts = generateWeekWorkouts(weekStart, targetMileage);
        const created: PlannedWorkoutSummary[] = [];

        for (const workout of workouts) {
          const id = insertWithEvent(
            'planned_workouts',
            workout,
            {
              source: 'api',
              reason: `Weekly plan: ${weekStart}`,
            }
          );
          created.push({
            id,
            date: workout.local_date,
            type: workout.type,
            target_distance_meters: workout.target_distance_meters,
            prescription: workout.prescription,
          });
        }

        const decision = await recordDecision(
          'plan_week',
          {
            week_start: weekStart,
            target_mileage: targetMileage,
            current_weekly_mileage: context.weekly_mileage,
          },
          {
            workouts_planned: created.length,
            workouts: created,
          },
          policies.map(p => p.id),
          trace_id
        );

        return {
          week_start: weekStart,
          workouts_planned: created.length,
          total_distance_meters: created.reduce(
            (sum, w) => sum + (w.target_distance_meters ?? 0),
            0
          ),
          decision_id: decision.id,
          workouts: created,
        };
      }
    );

    return success<WeekPlanResult>(result, trace_id, { cached });
  });
}

// ============================================
// Helper Functions
// ============================================

function getNextMonday(): string {
  const today = new Date();
  const day = today.getDay();
  const diff = day === 0 ? 1 : 8 - day;
  today.setDate(today.getDate() + diff);
  return today.toISOString().split('T')[0];
}

function addDays(date: string, days: number): string {
  const d = new Date(date);
  d.setDate(d.getDate() + days);
  return d.toISOString().split('T')[0];
}

function estimateWeeklyTarget(context: ReturnType<typeof loadContext>): number {
  // Start from current weekly mileage + safe ramp
  const current = context.weekly_mileage;
  const maxRamp = 0.1; // 10%
  return Math.round(current * (1 + maxRamp));
}

function calculateSafeWeeklyTarget(context: ReturnType<typeof loadContext>): number {
  const current = context.weekly_mileage;
  const prev = context.weekly_mileage_prev;

  // Apply 10% ramp rule
  const maxTarget = prev > 0 ? prev * 1.1 : current * 1.1;

  return Math.round(Math.min(maxTarget, current * 1.1));
}

function previewPlan(
  params: PlanCreateParams,
  _weeklyTarget: number,
  _context: ReturnType<typeof loadContext>
): PlanResult {
  const workoutsPerWeek = 5;
  return {
    plan_id: 'preview',
    weeks_planned: params.weeks,
    workouts_created: params.weeks * workoutsPerWeek,
    decision_id: 'preview',
  };
}

function generateWeekWorkouts(
  weekStart: string,
  targetMileageMeters: number,
  _goalRace?: string,
  _weekNumber?: number,
  _totalWeeks?: number
): Array<{
  local_date: string;
  type: string;
  target_distance_meters: number | null;
  target_duration_seconds: number | null;
  prescription: string | null;
  priority: string;
  status: string;
}> {
  const workouts: Array<{
    local_date: string;
    type: string;
    target_distance_meters: number | null;
    target_duration_seconds: number | null;
    prescription: string | null;
    priority: string;
    status: string;
  }> = [];

  // Simple weekly structure:
  // Mon: Easy, Tue: Quality, Wed: Easy, Thu: Quality, Fri: Rest, Sat: Long, Sun: Easy/Rest

  const structure = [
    { day: 0, type: 'easy', pct: 0.12 },      // Monday
    { day: 1, type: 'tempo', pct: 0.15 },     // Tuesday
    { day: 2, type: 'easy', pct: 0.12 },      // Wednesday
    { day: 3, type: 'interval', pct: 0.13 },  // Thursday
    { day: 5, type: 'long', pct: 0.28 },      // Saturday
    { day: 6, type: 'easy', pct: 0.10 },      // Sunday (recovery)
  ];

  for (const session of structure) {
    const date = addDays(weekStart, session.day);
    const distance = Math.round(targetMileageMeters * session.pct);

    workouts.push({
      local_date: date,
      type: session.type,
      target_distance_meters: distance,
      target_duration_seconds: null,
      prescription: generatePrescription(session.type, distance),
      priority: session.type === 'long' || session.type === 'tempo' ? 'high' : 'normal',
      status: 'planned',
    });
  }

  return workouts;
}

function generatePrescription(type: string, distanceMeters: number): string {
  const miles = (distanceMeters / 1609.344).toFixed(1);

  switch (type) {
    case 'easy':
      return `${miles} miles easy. Conversational pace.`;
    case 'tempo':
      return `${miles} miles with tempo work. 2 mile warmup, ${(parseFloat(miles) - 3).toFixed(1)} miles at tempo, 1 mile cooldown.`;
    case 'interval':
      return `${miles} miles total with intervals. Warmup, 6x800m with 400m recovery, cooldown.`;
    case 'long':
      return `${miles} miles long run. Start easy, finish strong.`;
    default:
      return `${miles} miles ${type}.`;
  }
}
