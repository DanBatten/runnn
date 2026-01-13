/**
 * Timezone Management CLI
 *
 * View current timezone detection and optionally set overrides.
 */

import chalk from 'chalk';
import { isDbInitialized, execute, queryOne, closeDb } from '../db/client.js';
import { getTimezone } from '../util/timezone.js';

export async function timezoneCommand(options: {
  set?: string;
  clear?: boolean;
}): Promise<void> {
  const dbPath = process.env.DATABASE_PATH ?? './data/coach.db';

  // Handle set/clear without requiring DB for display
  if (options.set || options.clear) {
    if (!isDbInitialized(dbPath)) {
      console.log(chalk.red('Database not initialized. Run: runnn init'));
      return;
    }

    if (options.clear) {
      execute(
        "DELETE FROM athlete_knowledge WHERE key = 'timezone_override'",
        []
      );
      console.log(chalk.green('✓ Timezone override cleared. Using system timezone.'));
    } else if (options.set) {
      // Validate timezone
      try {
        Intl.DateTimeFormat('en-US', { timeZone: options.set });
      } catch {
        console.log(chalk.red(`Invalid timezone: ${options.set}`));
        console.log(chalk.gray('Examples: America/Los_Angeles, Pacific/Auckland, Europe/Copenhagen'));
        closeDb();
        return;
      }

      // Check if override exists
      const existing = queryOne<{ value: string }>(
        "SELECT value FROM athlete_knowledge WHERE key = 'timezone_override'",
        []
      );

      if (existing) {
        execute(
          "UPDATE athlete_knowledge SET value = ?, updated_at = datetime('now') WHERE key = 'timezone_override'",
          [options.set]
        );
      } else {
        execute(
          "INSERT INTO athlete_knowledge (key, value, type, created_at, updated_at) VALUES ('timezone_override', ?, 'preference', datetime('now'), datetime('now'))",
          [options.set]
        );
      }

      console.log(chalk.green(`✓ Timezone override set to: ${options.set}`));
    }

    closeDb();
  }

  // Display current timezone info
  console.log('');
  console.log(chalk.bold('TIMEZONE CONFIGURATION'));
  console.log(chalk.gray('─'.repeat(50)));

  // Try to get timezone info (may fail if DB not initialized)
  let tzInfo;
  try {
    if (isDbInitialized(dbPath)) {
      tzInfo = getTimezone();
    } else {
      // Get system timezone without DB
      const systemTz = Intl.DateTimeFormat().resolvedOptions().timeZone;
      const now = new Date();
      const dateFormatter = new Intl.DateTimeFormat('en-CA', {
        timeZone: systemTz,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
      });
      const timeFormatter = new Intl.DateTimeFormat('en-US', {
        timeZone: systemTz,
        hour: '2-digit',
        minute: '2-digit',
        hour12: true,
      });
      tzInfo = {
        timezone: systemTz,
        source: 'system' as const,
        localDate: dateFormatter.format(now),
        localTime: timeFormatter.format(now),
      };
    }
  } catch {
    console.log(chalk.red('Could not determine timezone'));
    return;
  }

  const sourceLabel = {
    override: chalk.yellow('Database override'),
    system: chalk.green('System (auto-detected)'),
    env: chalk.blue('Environment variable'),
    default: chalk.gray('Default (UTC)'),
  };

  console.log(`  Timezone:    ${chalk.bold(tzInfo.timezone)}`);
  console.log(`  Source:      ${sourceLabel[tzInfo.source]}`);
  console.log(`  Local date:  ${tzInfo.localDate}`);
  console.log(`  Local time:  ${tzInfo.localTime}`);
  console.log('');

  // Show common timezones for reference
  console.log(chalk.gray('Common timezones:'));
  console.log(chalk.gray('  America/Los_Angeles  (LA, PST/PDT)'));
  console.log(chalk.gray('  Pacific/Auckland     (NZ, NZST/NZDT)'));
  console.log(chalk.gray('  Europe/Copenhagen    (Denmark, CET/CEST)'));
  console.log('');

  console.log(chalk.gray('Usage:'));
  console.log(chalk.gray('  runnn timezone              Show current timezone'));
  console.log(chalk.gray('  runnn timezone --set <tz>   Override timezone'));
  console.log(chalk.gray('  runnn timezone --clear      Use system timezone'));
  console.log('');

  if (isDbInitialized(dbPath)) {
    closeDb();
  }
}
