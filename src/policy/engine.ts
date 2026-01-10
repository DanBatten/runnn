/**
 * Policy Engine - Evaluate coaching policies against context
 *
 * Policies are deterministic rules that:
 * - Are versioned and testable
 * - Produce explainable decisions
 * - Can be overridden by the user
 */

import type {
  Policy,
  PolicyContext,
  PolicyCondition,
  PolicyAction,
  PolicyEvaluationResult,
} from './types.js';

/**
 * Evaluate a single condition against context
 */
function evaluateCondition(
  condition: PolicyCondition,
  context: PolicyContext
): { met: boolean; explanation: string } {
  const fieldValue = getFieldValue(condition.field, context);

  // Handle null/undefined field values
  if (fieldValue === null || fieldValue === undefined) {
    return {
      met: false,
      explanation: `${condition.field} is not available`,
    };
  }

  const { operator, value } = condition;

  switch (operator) {
    case 'eq':
      return {
        met: fieldValue === value,
        explanation: `${condition.field} (${fieldValue}) ${fieldValue === value ? '=' : '≠'} ${value}`,
      };

    case 'neq':
      return {
        met: fieldValue !== value,
        explanation: `${condition.field} (${fieldValue}) ${fieldValue !== value ? '≠' : '='} ${value}`,
      };

    case 'gt':
      return {
        met: Number(fieldValue) > Number(value),
        explanation: `${condition.field} (${fieldValue}) ${Number(fieldValue) > Number(value) ? '>' : '≤'} ${value}`,
      };

    case 'gte':
      return {
        met: Number(fieldValue) >= Number(value),
        explanation: `${condition.field} (${fieldValue}) ${Number(fieldValue) >= Number(value) ? '≥' : '<'} ${value}`,
      };

    case 'lt':
      return {
        met: Number(fieldValue) < Number(value),
        explanation: `${condition.field} (${fieldValue}) ${Number(fieldValue) < Number(value) ? '<' : '≥'} ${value}`,
      };

    case 'lte':
      return {
        met: Number(fieldValue) <= Number(value),
        explanation: `${condition.field} (${fieldValue}) ${Number(fieldValue) <= Number(value) ? '≤' : '>'} ${value}`,
      };

    case 'between':
      if (!Array.isArray(value) || value.length !== 2) {
        return { met: false, explanation: `Invalid between value for ${condition.field}` };
      }
      const [min, max] = value as unknown as [number, number];
      const inRange = Number(fieldValue) >= min && Number(fieldValue) <= max;
      return {
        met: inRange,
        explanation: `${condition.field} (${fieldValue}) ${inRange ? 'in' : 'not in'} [${min}, ${max}]`,
      };

    case 'in':
      if (!Array.isArray(value)) {
        return { met: false, explanation: `Invalid in value for ${condition.field}` };
      }
      const isIn = value.includes(fieldValue);
      return {
        met: isIn,
        explanation: `${condition.field} (${fieldValue}) ${isIn ? 'in' : 'not in'} [${value.join(', ')}]`,
      };

    case 'contains':
      const contains = String(fieldValue).toLowerCase().includes(String(value).toLowerCase());
      return {
        met: contains,
        explanation: `${condition.field} ${contains ? 'contains' : 'does not contain'} "${value}"`,
      };

    default:
      return {
        met: false,
        explanation: `Unknown operator: ${operator}`,
      };
  }
}

/**
 * Get a field value from context, supporting nested paths
 */
function getFieldValue(field: string, context: PolicyContext): unknown {
  const parts = field.split('.');
  let value: unknown = context;

  for (const part of parts) {
    if (value === null || value === undefined) return undefined;
    value = (value as Record<string, unknown>)[part];
  }

  return value;
}

/**
 * Evaluate all conditions for a policy
 * Default behavior: ALL conditions must be met (AND logic)
 */
function evaluateConditions(
  conditions: PolicyCondition[],
  context: PolicyContext
): { allMet: boolean; met: string[]; notMet: string[] } {
  const met: string[] = [];
  const notMet: string[] = [];

  for (const condition of conditions) {
    // Handle nested AND/OR conditions
    if (condition.operator === 'and' && Array.isArray(condition.value)) {
      const nested = evaluateConditions(condition.value as PolicyCondition[], context);
      if (nested.allMet) {
        met.push(...nested.met);
      } else {
        notMet.push(...nested.notMet);
      }
      continue;
    }

    if (condition.operator === 'or' && Array.isArray(condition.value)) {
      const nestedConditions = condition.value as PolicyCondition[];
      let anyMet = false;
      for (const nc of nestedConditions) {
        // Handle nested AND/OR within OR
        if ((nc.operator === 'and' || nc.operator === 'or') && Array.isArray(nc.value)) {
          const nested = evaluateConditions([nc], context);
          if (nested.allMet) {
            met.push(...nested.met);
            anyMet = true;
            break;
          }
        } else {
          const result = evaluateCondition(nc, context);
          if (result.met) {
            met.push(result.explanation);
            anyMet = true;
            break;
          }
        }
      }
      if (!anyMet) {
        notMet.push(`None of OR conditions met for ${condition.field}`);
      }
      continue;
    }

    const result = evaluateCondition(condition, context);
    if (result.met) {
      met.push(result.explanation);
    } else {
      notMet.push(result.explanation);
    }
  }

  return {
    allMet: notMet.length === 0,
    met,
    notMet,
  };
}

/**
 * Evaluate a single policy against context
 */
export function evaluatePolicy(
  policy: Policy,
  context: PolicyContext
): PolicyEvaluationResult {
  const { rules } = policy;

  // Check if policy is overridden
  if (context.active_overrides?.includes(policy.name)) {
    return {
      policy_id: policy.id,
      policy_name: policy.name,
      policy_version: policy.version,
      triggered: false,
      conditions_met: [],
      conditions_not_met: [`Policy "${policy.name}" is currently overridden`],
      recommended_actions: [],
      explanation: `Policy "${policy.name}" is overridden by user`,
    };
  }

  const conditionResults = evaluateConditions(rules.conditions, context);

  const result: PolicyEvaluationResult = {
    policy_id: policy.id,
    policy_name: policy.name,
    policy_version: policy.version,
    triggered: conditionResults.allMet,
    conditions_met: conditionResults.met,
    conditions_not_met: conditionResults.notMet,
    recommended_actions: conditionResults.allMet ? rules.actions : [],
    explanation: '',
  };

  // Generate explanation
  if (result.triggered) {
    result.explanation = `Policy "${policy.name}" triggered: ${conditionResults.met.join('; ')}`;
  } else {
    result.explanation = `Policy "${policy.name}" not triggered: ${conditionResults.notMet.join('; ')}`;
  }

  return result;
}

/**
 * Evaluate multiple policies and return all results
 * Policies are evaluated in priority order
 */
export function evaluatePolicies(
  policies: Policy[],
  context: PolicyContext
): PolicyEvaluationResult[] {
  // Sort by priority (higher priority first)
  const sorted = [...policies].sort((a, b) => {
    const priorityA = a.rules.priority ?? 0;
    const priorityB = b.rules.priority ?? 0;
    return priorityB - priorityA;
  });

  return sorted.map(policy => evaluatePolicy(policy, context));
}

/**
 * Get recommended actions from policy evaluation results
 * Deduplicates and merges actions from triggered policies
 */
export function getRecommendedActions(
  results: PolicyEvaluationResult[]
): PolicyAction[] {
  const actions: PolicyAction[] = [];
  const seenTypes = new Set<string>();

  for (const result of results) {
    if (!result.triggered) continue;

    for (const action of result.recommended_actions) {
      // Dedupe by action type (first policy wins)
      const key = `${action.type}:${JSON.stringify(action.params)}`;
      if (!seenTypes.has(key)) {
        seenTypes.add(key);
        actions.push(action);
      }
    }
  }

  return actions;
}

/**
 * Generate a human-readable summary of policy evaluations
 */
export function generatePolicySummary(
  results: PolicyEvaluationResult[]
): string {
  const triggered = results.filter(r => r.triggered);
  const notTriggered = results.filter(r => !r.triggered);

  const lines: string[] = [];

  if (triggered.length > 0) {
    lines.push('Triggered policies:');
    for (const r of triggered) {
      lines.push(`  - ${r.policy_name} v${r.policy_version}`);
      lines.push(`    ${r.explanation}`);
      if (r.recommended_actions.length > 0) {
        lines.push(`    Actions: ${r.recommended_actions.map(a => a.type).join(', ')}`);
      }
    }
  }

  if (notTriggered.length > 0 && lines.length > 0) {
    lines.push('');
  }

  if (notTriggered.length > 0) {
    lines.push('Not triggered:');
    for (const r of notTriggered) {
      lines.push(`  - ${r.policy_name}: ${r.conditions_not_met[0] || 'conditions not met'}`);
    }
  }

  return lines.join('\n');
}

/**
 * Create a hash of active policies for audit trail
 */
export function hashPolicies(policies: Policy[]): string {
  const data = policies
    .filter(p => p.is_active)
    .map(p => `${p.id}:${p.version}`)
    .sort()
    .join(',');

  // Simple hash for identification (not cryptographic)
  let hash = 0;
  for (let i = 0; i < data.length; i++) {
    const char = data.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash;
  }
  return Math.abs(hash).toString(16).padStart(8, '0');
}
