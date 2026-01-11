/**
 * Doctor command - Check data quality and detect anomalies
 */

import chalk from 'chalk';
import { isDbInitialized, closeDb } from '../db/client.js';
import { verifySchema } from '../db/migrate.js';
import { runAnomalyDetection, getOpenIssues, resolveIssue } from '../integrity/anomaly-detector.js';
import { checkAllPromptsCompatibility, generateCompatibilityReport } from '../compatibility/prompt-checker.js';

interface DoctorOptions {
  fix?: boolean;
  compat?: boolean;
  verbose?: boolean;
}

interface DataIssue {
  id: string;
  issue_type: string;
  severity: string;
  description: string;
  suggested_fix: string | null;
  status: string;
}

export async function doctorCommand(options: DoctorOptions): Promise<void> {
  const dbPath = process.env.DATABASE_PATH ?? './data/coach.db';

  if (!isDbInitialized(dbPath)) {
    console.log(chalk.yellow('Database not initialized'));
    console.log(`Run ${chalk.cyan('runnn init')} to create the database`);
    return;
  }

  console.log(chalk.bold('Runnn Doctor'));
  console.log('============');
  console.log('');

  let issuesFound = 0;

  // Schema verification
  console.log(chalk.blue('Checking schema...'));
  const { valid, issues } = verifySchema();
  if (valid) {
    console.log(chalk.green('  Schema: OK'));
  } else {
    console.log(chalk.red('  Schema: INVALID'));
    issues.forEach(i => {
      console.log(chalk.red(`    - ${i}`));
      issuesFound++;
    });
  }

  // Compatibility check
  if (options.compat) {
    console.log('');
    console.log(chalk.blue('Checking prompt ↔ schema compatibility...'));

    try {
      const results = checkAllPromptsCompatibility();
      let compatIssues = 0;
      let compatWarnings = 0;

      for (const [promptName, result] of results) {
        if (result.compatible) {
          if (options.verbose) {
            console.log(chalk.green(`  ✓ ${promptName}`));
          }
        } else {
          console.log(chalk.red(`  ✗ ${promptName}`));
          compatIssues++;

          for (const issue of result.issues) {
            console.log(chalk.red(`      ${issue}`));
          }

          if (result.schema_check.missing_tables.length > 0) {
            console.log(chalk.red(`      Missing tables: ${result.schema_check.missing_tables.join(', ')}`));
          }

          if (result.schema_check.missing_columns.length > 0) {
            const cols = result.schema_check.missing_columns.map(c => `${c.table}.${c.column}`);
            console.log(chalk.red(`      Missing columns: ${cols.join(', ')}`));
          }
        }

        for (const warning of result.warnings) {
          console.log(chalk.yellow(`      Warning: ${warning}`));
          compatWarnings++;
        }
      }

      if (compatIssues === 0) {
        console.log(chalk.green(`  All ${results.size} prompts compatible with schema`));
      } else {
        console.log(chalk.red(`  ${compatIssues} prompt(s) have compatibility issues`));
        issuesFound += compatIssues;
      }

      if (compatWarnings > 0 && !options.verbose) {
        console.log(chalk.yellow(`  ${compatWarnings} warning(s) - run with --verbose for details`));
      }

      if (options.verbose) {
        console.log('');
        console.log(chalk.gray('Full compatibility report:'));
        console.log(chalk.gray(generateCompatibilityReport()));
      }
    } catch (err) {
      console.log(chalk.yellow('  Could not run compatibility checks'));
      if (options.verbose && err instanceof Error) {
        console.log(chalk.gray(`    ${err.message}`));
      }
    }
  }

  // Run anomaly detection
  console.log('');
  console.log(chalk.blue('Running anomaly detection...'));

  const anomalyResult = runAnomalyDetection();

  if (anomalyResult.issuesFound === 0) {
    console.log(chalk.green('  No anomalies detected'));
  } else {
    console.log(chalk.yellow(`  Found ${anomalyResult.issuesFound} potential issue(s):`));
    for (const [type, count] of Object.entries(anomalyResult.issuesByType)) {
      console.log(chalk.gray(`    - ${type}: ${count}`));
    }

    if (options.verbose) {
      console.log('');
      for (const issue of anomalyResult.newIssues) {
        const color = issue.severity === 'critical' ? chalk.red :
                      issue.severity === 'error' ? chalk.yellow :
                      chalk.gray;
        console.log(color(`    [${issue.severity}] ${issue.description}`));
      }
    }

    issuesFound += anomalyResult.issuesFound;
  }

  // Check for existing open data issues
  console.log('');
  console.log(chalk.blue('Checking existing data issues...'));
  const openIssues = getOpenIssues();

  if (openIssues.length === 0) {
    console.log(chalk.green('  No open data issues'));
  } else {
    console.log(chalk.yellow(`  ${openIssues.length} open issue(s):`));

    // Group by severity
    const bySeverity: Record<string, DataIssue[]> = {};
    for (const issue of openIssues) {
      if (!bySeverity[issue.severity]) {
        bySeverity[issue.severity] = [];
      }
      bySeverity[issue.severity].push(issue);
    }

    // Display in severity order
    for (const severity of ['critical', 'error', 'warning']) {
      const issues = bySeverity[severity] || [];
      if (issues.length === 0) continue;

      const color = severity === 'critical' ? chalk.red :
                    severity === 'error' ? chalk.yellow :
                    chalk.gray;

      console.log(color(`  ${severity.toUpperCase()} (${issues.length}):`));

      const displayIssues = options.verbose ? issues : issues.slice(0, 5);
      for (const issue of displayIssues) {
        console.log(color(`    - [${issue.issue_type}] ${issue.description}`));
        if (options.verbose && issue.suggested_fix) {
          console.log(chalk.gray(`      Fix: ${issue.suggested_fix}`));
        }
      }

      if (!options.verbose && issues.length > 5) {
        console.log(chalk.gray(`    ... and ${issues.length - 5} more`));
      }
    }

    issuesFound += openIssues.length;

    if (options.fix) {
      console.log('');
      console.log(chalk.blue('Attempting auto-fixes...'));
      await attemptAutoFixes(openIssues, options.verbose);
    }
  }

  // Summary
  console.log('');
  console.log('─'.repeat(40));
  if (issuesFound === 0) {
    console.log(chalk.green('All checks passed!'));
  } else {
    console.log(chalk.yellow(`Found ${issuesFound} issue(s)`));
    if (!options.fix) {
      console.log(`Run ${chalk.cyan('runnn doctor --fix')} to attempt auto-repair`);
    }
    console.log(`Run ${chalk.cyan('runnn doctor --verbose')} to see all issues`);
  }

  closeDb();
}

/**
 * Attempt to auto-fix safe issues
 */
async function attemptAutoFixes(issues: DataIssue[], verbose?: boolean): Promise<void> {
  let fixed = 0;
  let skipped = 0;

  for (const issue of issues) {
    // Only auto-fix certain issue types
    const safeToFix = [
      'missing_notes', // Warning, no action needed
      'duplicate', // Can mark one as ignored
    ];

    if (!safeToFix.includes(issue.issue_type)) {
      skipped++;
      continue;
    }

    switch (issue.issue_type) {
      case 'missing_notes':
        // This is informational, just acknowledge
        resolveIssue(issue.id, 'ignored', 'auto-fix');
        fixed++;
        if (verbose) {
          console.log(chalk.gray(`  Acknowledged: ${issue.description}`));
        }
        break;

      case 'duplicate':
        // For now, just flag - duplicates need manual review
        if (verbose) {
          console.log(chalk.yellow(`  Skipping duplicate (needs manual review): ${issue.description}`));
        }
        skipped++;
        break;

      default:
        skipped++;
    }
  }

  console.log(chalk.green(`  Auto-fixed: ${fixed}`));
  console.log(chalk.gray(`  Skipped (needs manual review): ${skipped}`));
}
