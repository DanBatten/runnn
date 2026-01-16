/**
 * Policy API - List and evaluate coaching policies
 *
 * Read operations for policy information and evaluation.
 */

import {
  ApiEnvelope,
  PolicyListResult,
  PolicySummary,
  PolicyEvalResult,
  generateTraceId,
  success,
  failure,
  timeOperation,
} from './types.js';
import { getActivePolicies, getPolicyById } from '../policy/loader.js';
import { evaluatePolicy as evalPolicy, evaluatePolicies as evalPolicies } from '../policy/engine.js';
import { loadContext, toPolicyContext } from '../coach/context.js';
import type { PolicyEvaluationResult } from '../policy/types.js';

/**
 * List all policies
 */
export async function listPolicies(): Promise<ApiEnvelope<PolicyListResult>> {
  const trace_id = generateTraceId();

  return timeOperation(trace_id, async () => {
    const policies = getActivePolicies();

    const summaries: PolicySummary[] = policies.map(p => ({
      id: p.id,
      name: p.name,
      version: String(p.version),
      description: p.summary ?? '',
      is_active: p.is_active,
      priority: p.rules.priority ?? 0,
    }));

    return success<PolicyListResult>(
      {
        policies: summaries,
        total_count: summaries.length,
        active_count: summaries.filter(p => p.is_active).length,
      },
      trace_id
    );
  });
}

/**
 * Get a specific policy by ID
 */
export async function getPolicy(
  policy_id: string
): Promise<ApiEnvelope<PolicySummary | null>> {
  const trace_id = generateTraceId();

  return timeOperation(trace_id, async () => {
    const policy = getPolicyById(policy_id);

    if (!policy) {
      return success<PolicySummary | null>(null, trace_id);
    }

    return success<PolicySummary>(
      {
        id: policy.id,
        name: policy.name,
        version: String(policy.version),
        description: policy.summary ?? '',
        is_active: policy.is_active,
        priority: policy.rules.priority ?? 0,
      },
      trace_id
    );
  });
}

/**
 * Evaluate a specific policy against current context
 */
export async function evaluatePolicy(
  policy_id: string,
  date?: string
): Promise<ApiEnvelope<PolicyEvalResult>> {
  const trace_id = generateTraceId();

  return timeOperation(trace_id, async () => {
    const policy = getPolicyById(policy_id);

    if (!policy) {
      return failure<PolicyEvalResult>(
        'POLICY_NOT_FOUND',
        `Policy ${policy_id} not found`,
        trace_id
      );
    }

    // Load context and evaluate
    const context = loadContext(date);
    const policyContext = toPolicyContext(context);
    const result = evalPolicy(policy, policyContext);

    return success<PolicyEvalResult>(
      formatEvalResult(result),
      trace_id
    );
  });
}

/**
 * Evaluate all active policies against current context
 */
export async function evaluateAllPolicies(
  date?: string
): Promise<ApiEnvelope<PolicyEvalResult[]>> {
  const trace_id = generateTraceId();

  return timeOperation(trace_id, async () => {
    const policies = getActivePolicies();
    const context = loadContext(date);
    const policyContext = toPolicyContext(context);

    const results = evalPolicies(policies, policyContext);

    return success<PolicyEvalResult[]>(
      results.map(formatEvalResult),
      trace_id
    );
  });
}

/**
 * Get triggered policies only
 */
export async function getTriggeredPolicies(
  date?: string
): Promise<ApiEnvelope<PolicyEvalResult[]>> {
  const trace_id = generateTraceId();

  return timeOperation(trace_id, async () => {
    const policies = getActivePolicies();
    const context = loadContext(date);
    const policyContext = toPolicyContext(context);

    const results = evalPolicies(policies, policyContext);
    const triggered = results.filter(r => r.triggered);

    return success<PolicyEvalResult[]>(
      triggered.map(formatEvalResult),
      trace_id
    );
  });
}

// ============================================
// Helper Functions
// ============================================

function formatEvalResult(result: PolicyEvaluationResult): PolicyEvalResult {
  return {
    policy_id: result.policy_id,
    policy_name: result.policy_name,
    triggered: result.triggered,
    conditions_met: result.conditions_met,
    conditions_not_met: result.conditions_not_met,
    recommended_actions: result.recommended_actions.map(a => a.type),
    explanation: result.explanation,
  };
}
