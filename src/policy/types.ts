/**
 * Policy Type Definitions
 */

export interface Policy {
  id: string;
  name: string;
  version: number;
  rules: PolicyRules;
  summary: string;
  is_active: boolean;
  created_at: string;
  activated_at: string | null;
}

export interface PolicyRules {
  type: PolicyType;
  conditions: PolicyCondition[];
  actions: PolicyAction[];
  priority?: number;
}

export type PolicyType =
  | 'weekly_ramp'
  | 'quality_conversion'
  | 'travel_recovery'
  | 'injury_escalation'
  | 'workout_priority';

export interface PolicyCondition {
  field: string;
  operator: ConditionOperator;
  value: number | string | boolean | null;
  unit?: string;
}

export type ConditionOperator =
  | 'eq'
  | 'neq'
  | 'gt'
  | 'gte'
  | 'lt'
  | 'lte'
  | 'between'
  | 'in'
  | 'contains'
  | 'and'
  | 'or';

export interface PolicyAction {
  type: ActionType;
  params: Record<string, unknown>;
}

export type ActionType =
  | 'convert_workout'
  | 'skip_workout'
  | 'reduce_intensity'
  | 'reduce_volume'
  | 'add_rest_day'
  | 'flag_for_review'
  | 'warn'
  | 'block';

export interface PolicyContext {
  // Health metrics
  hrv?: number;
  hrv_baseline_7d?: number;
  hrv_delta_pct?: number;
  hrv_status?: string;
  rhr?: number;
  rhr_baseline_7d?: number;
  rhr_delta_pct?: number;
  sleep_hours?: number;
  sleep_quality?: number;
  sleep_baseline_7d?: number;
  sleep_delta_pct?: number;
  body_battery?: number;
  stress_level?: number;

  // Training load
  weekly_mileage?: number;
  weekly_mileage_prev?: number;
  weekly_ramp_pct?: number;
  training_load_7d?: number;
  training_load_28d?: number;
  acute_chronic_ratio?: number;
  days_since_last_run?: number;
  consecutive_hard_days?: number;

  // Workout context
  planned_workout_type?: string;
  planned_workout_priority?: string;
  planned_distance_meters?: number;
  planned_duration_seconds?: number;
  days_since_quality?: number;
  days_since_long_run?: number;

  // Life context
  travel_days_ago?: number;
  timezone_change_hours?: number;
  life_event_severity?: number;
  strength_session_yesterday?: boolean;

  // Injury context
  active_injury_severity?: number;
  active_injury_location?: string;
  injury_trend?: 'improving' | 'stable' | 'worsening';

  // Override context
  active_overrides?: string[];
}

export interface PolicyEvaluationResult {
  policy_id: string;
  policy_name: string;
  policy_version: number;
  triggered: boolean;
  conditions_met: string[];
  conditions_not_met: string[];
  recommended_actions: PolicyAction[];
  explanation: string;
}

export interface PolicyTest {
  id: string;
  policy_id: string;
  name: string;
  fixture: PolicyContext;
  expected_triggered: boolean;
  expected_actions?: ActionType[];
  last_run_at?: string;
  last_result?: 'pass' | 'fail';
}

export interface PolicyTestResult {
  test_id: string;
  passed: boolean;
  expected_triggered: boolean;
  actual_triggered: boolean;
  expected_actions: ActionType[];
  actual_actions: ActionType[];
  error?: string;
}
