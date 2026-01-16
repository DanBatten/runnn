/**
 * Decisions API - First-class decision records
 *
 * Every recommendation persists a decision record for:
 * - Reproducibility ("why did you recommend X?")
 * - Audit trail
 * - Learning and pattern detection
 */

import {
  ApiEnvelope,
  DecisionRecord,
  DecisionExplanation,
  generateTraceId,
  generateId,
  success,
  failure,
  timeOperation,
} from './types.js';
import { query, queryOne, insertWithEvent } from '../db/client.js';

/**
 * Record a new decision
 */
export async function recordDecision(
  decision_type: string,
  inputs: Record<string, unknown>,
  output: unknown,
  policy_versions: string[],
  trace_id: string
): Promise<DecisionRecord> {
  const id = generateId('dec');
  const created_at = new Date().toISOString();

  try {
    insertWithEvent(
      'decisions',
      {
        id,
        decision_type,
        inputs_json: JSON.stringify(inputs),
        output_json: JSON.stringify(output),
        policy_versions_json: JSON.stringify(policy_versions),
        trace_id,
        created_at,
      },
      {
        source: 'api',
        reason: `Decision: ${decision_type}`,
        entityId: id,
      }
    );
  } catch (err) {
    // Table might not exist yet - log but don't fail
    console.warn('Failed to record decision:', err);
  }

  return {
    id,
    created_at,
    decision_type,
    inputs,
    policy_versions,
    output,
    trace_id,
  };
}

/**
 * Get the latest decision
 */
export async function getLatestDecision(): Promise<ApiEnvelope<DecisionRecord | null>> {
  const trace_id = generateTraceId();

  return timeOperation(trace_id, async () => {
    try {
      const row = queryOne<{
        id: string;
        created_at: string;
        decision_type: string;
        inputs_json: string;
        output_json: string;
        policy_versions_json: string;
        trace_id: string;
        explanation_id: string | null;
      }>(
        `SELECT * FROM decisions ORDER BY created_at DESC LIMIT 1`
      );

      if (!row) {
        return success<DecisionRecord | null>(null, trace_id);
      }

      return success<DecisionRecord>(
        {
          id: row.id,
          created_at: row.created_at,
          decision_type: row.decision_type,
          inputs: JSON.parse(row.inputs_json),
          output: JSON.parse(row.output_json),
          policy_versions: JSON.parse(row.policy_versions_json),
          trace_id: row.trace_id,
          explanation_id: row.explanation_id ?? undefined,
        },
        trace_id
      );
    } catch (err) {
      // Table might not exist
      return success<DecisionRecord | null>(null, trace_id);
    }
  });
}

/**
 * Get a decision by ID
 */
export async function getDecisionById(
  decision_id: string
): Promise<ApiEnvelope<DecisionRecord | null>> {
  const trace_id = generateTraceId();

  return timeOperation(trace_id, async () => {
    try {
      const row = queryOne<{
        id: string;
        created_at: string;
        decision_type: string;
        inputs_json: string;
        output_json: string;
        policy_versions_json: string;
        trace_id: string;
        explanation_id: string | null;
      }>(
        `SELECT * FROM decisions WHERE id = ?`,
        [decision_id]
      );

      if (!row) {
        return success<DecisionRecord | null>(null, trace_id);
      }

      return success<DecisionRecord>(
        {
          id: row.id,
          created_at: row.created_at,
          decision_type: row.decision_type,
          inputs: JSON.parse(row.inputs_json),
          output: JSON.parse(row.output_json),
          policy_versions: JSON.parse(row.policy_versions_json),
          trace_id: row.trace_id,
          explanation_id: row.explanation_id ?? undefined,
        },
        trace_id
      );
    } catch (err) {
      return failure('DECISION_NOT_FOUND', `Decision ${decision_id} not found`, trace_id);
    }
  });
}

/**
 * Explain a decision - reconstruct the reasoning
 */
export async function explainDecision(
  decision_id: string
): Promise<ApiEnvelope<DecisionExplanation>> {
  const trace_id = generateTraceId();

  return timeOperation(trace_id, async () => {
    // Get the decision
    const decisionResult = await getDecisionById(decision_id);
    if (!decisionResult.ok || !decisionResult.data) {
      return failure<DecisionExplanation>(
        'DECISION_NOT_FOUND',
        `Decision ${decision_id} not found`,
        trace_id
      );
    }

    const decision = decisionResult.data;

    // Generate summaries
    const inputsSummary = summarizeInputs(decision.inputs);
    const policiesSummary = summarizePolicies(decision.policy_versions);
    const outputSummary = summarizeOutput(decision.output);

    // Build full explanation
    const fullExplanation = buildExplanation(decision);

    return success<DecisionExplanation>(
      {
        decision_id: decision.id,
        decision_type: decision.decision_type,
        created_at: decision.created_at,
        inputs_summary: inputsSummary,
        policies_summary: policiesSummary,
        output_summary: outputSummary,
        full_explanation: fullExplanation,
      },
      trace_id
    );
  });
}

/**
 * Get recent decisions
 */
export async function getRecentDecisions(params: {
  limit?: number;
  decision_type?: string;
}): Promise<ApiEnvelope<DecisionRecord[]>> {
  const trace_id = generateTraceId();

  return timeOperation(trace_id, async () => {
    const limit = params.limit ?? 20;

    try {
      let sql = `SELECT * FROM decisions`;
      const queryParams: unknown[] = [];

      if (params.decision_type) {
        sql += ` WHERE decision_type = ?`;
        queryParams.push(params.decision_type);
      }

      sql += ` ORDER BY created_at DESC LIMIT ?`;
      queryParams.push(limit);

      const rows = query<{
        id: string;
        created_at: string;
        decision_type: string;
        inputs_json: string;
        output_json: string;
        policy_versions_json: string;
        trace_id: string;
        explanation_id: string | null;
      }>(sql, queryParams);

      const decisions: DecisionRecord[] = rows.map(row => ({
        id: row.id,
        created_at: row.created_at,
        decision_type: row.decision_type,
        inputs: JSON.parse(row.inputs_json),
        output: JSON.parse(row.output_json),
        policy_versions: JSON.parse(row.policy_versions_json),
        trace_id: row.trace_id,
        explanation_id: row.explanation_id ?? undefined,
      }));

      return success<DecisionRecord[]>(decisions, trace_id);
    } catch (err) {
      // Table might not exist
      return success<DecisionRecord[]>([], trace_id);
    }
  });
}

// ============================================
// Helper Functions
// ============================================

function summarizeInputs(inputs: Record<string, unknown>): string {
  const parts: string[] = [];

  if (inputs.date) {
    parts.push(`Date: ${inputs.date}`);
  }
  if (inputs.readiness_status) {
    parts.push(`Readiness: ${inputs.readiness_status}`);
  }
  if (inputs.planned_type) {
    parts.push(`Planned: ${inputs.planned_type}`);
  }
  if (inputs.hrv) {
    parts.push(`HRV: ${inputs.hrv}`);
  }

  return parts.length > 0 ? parts.join(', ') : 'No inputs recorded';
}

function summarizePolicies(policyVersions: string[]): string {
  if (policyVersions.length === 0) {
    return 'No policies applied';
  }
  return `${policyVersions.length} policies applied: ${policyVersions.join(', ')}`;
}

function summarizeOutput(output: unknown): string {
  if (!output || typeof output !== 'object') {
    return 'No output recorded';
  }

  const out = output as Record<string, unknown>;
  const parts: string[] = [];

  if (out.workout_type) {
    parts.push(`Workout: ${out.workout_type}`);
  }
  if (out.modifications && Array.isArray(out.modifications) && out.modifications.length > 0) {
    parts.push(`Modifications: ${out.modifications.join(', ')}`);
  }
  if (out.recommendation) {
    parts.push(`Recommendation: ${out.recommendation}`);
  }

  return parts.length > 0 ? parts.join('; ') : JSON.stringify(output).slice(0, 100);
}

function buildExplanation(decision: DecisionRecord): string {
  const lines: string[] = [];

  lines.push(`Decision Type: ${decision.decision_type}`);
  lines.push(`Made at: ${decision.created_at}`);
  lines.push(`Trace ID: ${decision.trace_id}`);
  lines.push('');
  lines.push('Inputs:');
  for (const [key, value] of Object.entries(decision.inputs)) {
    lines.push(`  ${key}: ${JSON.stringify(value)}`);
  }
  lines.push('');
  lines.push('Policies Applied:');
  if (decision.policy_versions.length === 0) {
    lines.push('  (none)');
  } else {
    for (const policy of decision.policy_versions) {
      lines.push(`  - ${policy}`);
    }
  }
  lines.push('');
  lines.push('Output:');
  lines.push(`  ${JSON.stringify(decision.output, null, 2)}`);

  return lines.join('\n');
}
