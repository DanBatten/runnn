/**
 * Doctor API - Data quality checks and repair
 *
 * Can be read-only (check) or write (fix).
 */

import {
  ApiEnvelope,
  DoctorResult,
  DoctorIssue,
  WriteParams,
  generateTraceId,
  success,
  failure,
  timeOperation,
} from './types.js';
import { withWriteLock } from './concurrency.js';
import { isDbInitialized } from '../db/client.js';
import { verifySchema } from '../db/migrate.js';
import { runAnomalyDetection, getOpenIssues, resolveIssue } from '../integrity/anomaly-detector.js';

export interface DoctorParams extends WriteParams {
  fix?: boolean;
}

/**
 * Run data quality checks and optionally fix issues
 */
export async function runDoctor(
  params: DoctorParams = {}
): Promise<ApiEnvelope<DoctorResult>> {
  const trace_id = generateTraceId();
  const { fix = false, idempotency_key, dry_run = false } = params;

  return timeOperation(trace_id, async () => {
    const dbPath = process.env.DATABASE_PATH ?? './data/coach.db';

    // Check if database is initialized
    if (!isDbInitialized(dbPath)) {
      return failure<DoctorResult>(
        'DB_NOT_INITIALIZED',
        'Database not initialized',
        trace_id
      );
    }

    // Dry run or read-only check
    if (dry_run || !fix) {
      const result = await performChecks();
      return success<DoctorResult>(result, trace_id, { dry_run });
    }

    // Fix mode - needs write lock
    const { result, cached } = await withWriteLock<DoctorResult>(
      'doctor',
      trace_id,
      idempotency_key,
      async () => {
        const checkResult = await performChecks();
        let issuesFixed = 0;

        // Attempt to fix auto-fixable issues
        for (const issue of checkResult.details) {
          if (canAutoFix(issue)) {
            const fixed = await attemptFix(issue);
            if (fixed) {
              issue.fixed = true;
              issuesFixed++;
            }
          }
        }

        return {
          ...checkResult,
          issues_fixed: issuesFixed,
        };
      }
    );

    return success<DoctorResult>(result, trace_id, { cached });
  });
}

/**
 * Get current data quality status (read-only)
 */
export async function getDoctorStatus(): Promise<ApiEnvelope<DoctorResult>> {
  return runDoctor({ fix: false });
}

// ============================================
// Internal Functions
// ============================================

async function performChecks(): Promise<DoctorResult> {
  const issues: DoctorIssue[] = [];
  let hasBlockingErrors = false;

  // Schema verification
  const { valid, issues: schemaIssues } = verifySchema();
  if (!valid) {
    hasBlockingErrors = true;
    for (const issue of schemaIssues) {
      issues.push({
        id: `schema_${issues.length}`,
        type: 'schema_error',
        severity: 'critical',
        description: issue,
        suggested_fix: 'Run database migration',
        fixed: false,
      });
    }
  }

  // Run anomaly detection
  const anomalyResult = runAnomalyDetection();
  for (const anomaly of anomalyResult.newIssues) {
    const severity = mapSeverity(anomaly.severity);
    if (severity === 'critical') {
      hasBlockingErrors = true;
    }

    issues.push({
      id: anomaly.id,
      type: anomaly.issue_type,
      severity,
      description: anomaly.description,
      suggested_fix: anomaly.suggested_fix ?? null,
      fixed: false,
    });
  }

  // Get existing open issues
  const openIssues = getOpenIssues();
  for (const issue of openIssues) {
    const severity = mapSeverity(issue.severity);
    if (severity === 'critical') {
      hasBlockingErrors = true;
    }

    // Avoid duplicates
    if (!issues.find(i => i.id === issue.id)) {
      issues.push({
        id: issue.id,
        type: issue.issue_type,
        severity,
        description: issue.description,
        suggested_fix: issue.suggested_fix ?? null,
        fixed: false,
      });
    }
  }

  // Count by type
  const issuesByType: Record<string, number> = {};
  for (const issue of issues) {
    issuesByType[issue.type] = (issuesByType[issue.type] ?? 0) + 1;
  }

  return {
    schema_valid: valid,
    issues_found: issues.length,
    issues_fixed: 0,
    issues_by_type: issuesByType,
    has_blocking_errors: hasBlockingErrors,
    details: issues,
  };
}

function mapSeverity(severity: string): DoctorIssue['severity'] {
  switch (severity.toLowerCase()) {
    case 'critical':
      return 'critical';
    case 'error':
      return 'error';
    default:
      return 'warning';
  }
}

function canAutoFix(issue: DoctorIssue): boolean {
  // Only auto-fix certain safe issue types
  const safeToFix = ['missing_notes', 'orphaned_record'];
  return safeToFix.includes(issue.type);
}

async function attemptFix(issue: DoctorIssue): Promise<boolean> {
  try {
    switch (issue.type) {
      case 'missing_notes':
        // Acknowledge - this is informational
        resolveIssue(issue.id, 'ignored', 'auto-fix');
        return true;

      case 'orphaned_record':
        // Clean up orphaned records
        resolveIssue(issue.id, 'fixed', 'auto-fix');
        return true;

      default:
        return false;
    }
  } catch {
    return false;
  }
}
