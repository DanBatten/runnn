/**
 * Policy Tester - Run policy tests and validate changes
 */

import { evaluatePolicy } from './engine.js';
import { getPolicyById, getPolicyTests, updateTestResult, getActivePolicies } from './loader.js';
import type { Policy, PolicyContext, PolicyTest, PolicyTestResult, ActionType } from './types.js';

/**
 * Run a single policy test
 */
export function runPolicyTest(
  policy: Policy,
  test: PolicyTest
): PolicyTestResult {
  const context = test.fixture as PolicyContext;

  try {
    const result = evaluatePolicy(policy, context);

    const actualActions = result.recommended_actions.map(a => a.type);
    const expectedActions = test.expected_actions ?? [];

    // Check if test passed
    const triggeredMatch = result.triggered === test.expected_triggered;
    const actionsMatch = test.expected_triggered
      ? arraysEqual(actualActions, expectedActions)
      : true; // Don't check actions if not triggered

    const passed = triggeredMatch && actionsMatch;

    // Update test result in database
    updateTestResult(test.id, passed ? 'pass' : 'fail');

    return {
      test_id: test.id,
      passed,
      expected_triggered: test.expected_triggered,
      actual_triggered: result.triggered,
      expected_actions: expectedActions,
      actual_actions: actualActions,
    };
  } catch (error) {
    updateTestResult(test.id, 'fail');

    return {
      test_id: test.id,
      passed: false,
      expected_triggered: test.expected_triggered,
      actual_triggered: false,
      expected_actions: test.expected_actions ?? [],
      actual_actions: [],
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

/**
 * Run all tests for a policy
 */
export function runPolicyTests(policyId: string): {
  policy_name: string;
  total: number;
  passed: number;
  failed: number;
  results: PolicyTestResult[];
} {
  const policy = getPolicyById(policyId);
  if (!policy) {
    throw new Error(`Policy not found: ${policyId}`);
  }

  const tests = getPolicyTests(policyId);
  const results: PolicyTestResult[] = [];

  for (const test of tests) {
    results.push(runPolicyTest(policy, test));
  }

  return {
    policy_name: policy.name,
    total: results.length,
    passed: results.filter(r => r.passed).length,
    failed: results.filter(r => !r.passed).length,
    results,
  };
}

/**
 * Run all tests for all active policies
 */
export function runAllPolicyTests(): {
  total_policies: number;
  total_tests: number;
  total_passed: number;
  total_failed: number;
  by_policy: Array<{
    policy_name: string;
    passed: number;
    failed: number;
  }>;
} {
  const policies = getActivePolicies();

  let totalTests = 0;
  let totalPassed = 0;
  let totalFailed = 0;
  const byPolicy: Array<{ policy_name: string; passed: number; failed: number }> = [];

  for (const policy of policies) {
    const results = runPolicyTests(policy.id);
    totalTests += results.total;
    totalPassed += results.passed;
    totalFailed += results.failed;
    byPolicy.push({
      policy_name: results.policy_name,
      passed: results.passed,
      failed: results.failed,
    });
  }

  return {
    total_policies: policies.length,
    total_tests: totalTests,
    total_passed: totalPassed,
    total_failed: totalFailed,
    by_policy: byPolicy,
  };
}

/**
 * Validate a policy change by running tests
 * Returns true if all tests pass
 */
export function validatePolicyChange(policyId: string): {
  valid: boolean;
  message: string;
  results: PolicyTestResult[];
} {
  try {
    const testResults = runPolicyTests(policyId);

    if (testResults.failed > 0) {
      const failedTests = testResults.results.filter(r => !r.passed);
      const failureMessages = failedTests
        .map(r => {
          if (r.error) return `  - Error: ${r.error}`;
          if (r.expected_triggered !== r.actual_triggered) {
            return `  - Expected triggered=${r.expected_triggered}, got ${r.actual_triggered}`;
          }
          return `  - Expected actions [${r.expected_actions.join(', ')}], got [${r.actual_actions.join(', ')}]`;
        })
        .join('\n');

      return {
        valid: false,
        message: `${testResults.failed} of ${testResults.total} tests failed:\n${failureMessages}`,
        results: testResults.results,
      };
    }

    return {
      valid: true,
      message: `All ${testResults.total} tests passed`,
      results: testResults.results,
    };
  } catch (error) {
    return {
      valid: false,
      message: `Validation error: ${error instanceof Error ? error.message : String(error)}`,
      results: [],
    };
  }
}

/**
 * Helper to compare arrays (order-independent for actions)
 */
function arraysEqual(a: ActionType[], b: ActionType[]): boolean {
  if (a.length !== b.length) return false;
  const sortedA = [...a].sort();
  const sortedB = [...b].sort();
  return sortedA.every((val, idx) => val === sortedB[idx]);
}

/**
 * Generate a test report
 */
export function generateTestReport(results: {
  total_policies: number;
  total_tests: number;
  total_passed: number;
  total_failed: number;
  by_policy: Array<{ policy_name: string; passed: number; failed: number }>;
}): string {
  const lines: string[] = [
    'Policy Test Report',
    '==================',
    '',
    `Policies: ${results.total_policies}`,
    `Tests: ${results.total_tests}`,
    `Passed: ${results.total_passed}`,
    `Failed: ${results.total_failed}`,
    '',
    'By Policy:',
  ];

  for (const policy of results.by_policy) {
    const status = policy.failed === 0 ? '✓' : '✗';
    lines.push(`  ${status} ${policy.policy_name}: ${policy.passed}/${policy.passed + policy.failed}`);
  }

  return lines.join('\n');
}
