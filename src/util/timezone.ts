/**
 * Timezone Utilities
 *
 * Provides automatic timezone detection with database override capability.
 *
 * Priority order:
 * 1. athlete_knowledge 'timezone_override' (for forcing specific timezone)
 * 2. System timezone (auto-detected, follows laptop settings)
 * 3. ATHLETE_TIMEZONE env var (fallback)
 * 4. UTC (last resort)
 */

import { queryOne } from '../db/client.js';

interface TimezoneInfo {
  timezone: string;
  source: 'override' | 'system' | 'env' | 'default';
  localDate: string;
  localTime: string;
}

/**
 * Get the current timezone, auto-detecting from system when possible
 */
export function getTimezone(): TimezoneInfo {
  let timezone: string | undefined;
  let source: TimezoneInfo['source'] = 'default'; // Initialize to satisfy TypeScript

  // 1. Check for database override (useful for testing or edge cases)
  try {
    const override = queryOne<{ value: string }>(
      "SELECT value FROM athlete_knowledge WHERE key = 'timezone_override'",
      []
    );
    if (override?.value) {
      timezone = override.value;
      source = 'override';
    }
  } catch {
    // Database might not be initialized yet
  }

  // 2. Use system timezone (auto-detected from laptop settings)
  if (!timezone!) {
    try {
      timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
      source = 'system';
    } catch {
      // Fallback if Intl is not available
    }
  }

  // 3. Check env var
  if (!timezone!) {
    if (process.env.ATHLETE_TIMEZONE) {
      timezone = process.env.ATHLETE_TIMEZONE;
      source = 'env';
    }
  }

  // 4. Default to UTC
  if (!timezone!) {
    timezone = 'UTC';
    source = 'default';
  }

  // Get current local date/time in that timezone
  const now = new Date();
  const dateFormatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
  const timeFormatter = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    hour: '2-digit',
    minute: '2-digit',
    hour12: true,
  });

  return {
    timezone,
    source,
    localDate: dateFormatter.format(now),
    localTime: timeFormatter.format(now),
  };
}

/**
 * Get the current local date in YYYY-MM-DD format
 */
export function getLocalDate(daysOffset: number = 0): string {
  const { timezone } = getTimezone();
  const date = new Date();
  date.setDate(date.getDate() + daysOffset);

  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });

  return formatter.format(date);
}

/**
 * Get the day name for a given date
 */
export function getDayName(date: Date | string): string {
  const { timezone } = getTimezone();
  const d = typeof date === 'string' ? new Date(date + 'T12:00:00') : date;

  return d.toLocaleDateString('en-US', {
    weekday: 'long',
    timeZone: timezone
  });
}

/**
 * Format a date range for display
 */
export function formatDateRange(startDate: string, endDate: string): string {
  const { timezone } = getTimezone();

  const start = new Date(startDate + 'T12:00:00');
  const end = new Date(endDate + 'T12:00:00');

  const startFormatter = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    month: 'short',
    day: 'numeric',
  });

  const endFormatter = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });

  return `${startFormatter.format(start)} - ${endFormatter.format(end)}`;
}

/**
 * Get dates for the last N days in local timezone
 */
export function getLastNDays(n: number): string[] {
  const dates: string[] = [];
  for (let i = 0; i < n; i++) {
    dates.push(getLocalDate(-i));
  }
  return dates;
}
