/**
 * Readiness Baselines - Rolling averages for HRV, RHR, and sleep
 *
 * These baselines are the foundation of readiness assessment:
 * - 7-day averages for recent trends
 * - 30-day averages for stable reference
 * - Delta calculations for today vs baseline
 */

import { query, queryOne, execute } from '../db/client.js';

interface HealthSnapshot {
  local_date: string;
  hrv: number | null;
  resting_hr: number | null;
  sleep_hours: number | null;
}

interface BaselineRow {
  local_date: string;
  hrv_7day_avg: number | null;
  rhr_7day_avg: number | null;
  sleep_7day_avg: number | null;
  hrv_30day_avg: number | null;
  rhr_30day_avg: number | null;
  sleep_30day_avg: number | null;
  computed_at: string;
}

export interface ReadinessBaseline {
  local_date: string;
  hrv_7day_avg: number | null;
  rhr_7day_avg: number | null;
  sleep_7day_avg: number | null;
  hrv_30day_avg: number | null;
  rhr_30day_avg: number | null;
  sleep_30day_avg: number | null;
  computed_at: string;
}

export interface ReadinessDeltas {
  local_date: string;
  hrv_value: number | null;
  hrv_vs_7day: number | null;
  hrv_vs_30day: number | null;
  rhr_value: number | null;
  rhr_vs_7day: number | null;
  rhr_vs_30day: number | null;
  sleep_value: number | null;
  sleep_vs_7day: number | null;
  sleep_vs_30day: number | null;
}

/**
 * Compute baselines for a specific date
 */
export function computeBaselinesForDate(targetDate: string): ReadinessBaseline | null {
  // Get health data for the past 30 days (including target date)
  const snapshots = query<HealthSnapshot>(
    `SELECT local_date, hrv, resting_hr, sleep_hours
     FROM health_snapshots
     WHERE local_date <= ? AND local_date > date(?, '-31 days')
     ORDER BY local_date DESC`,
    [targetDate, targetDate]
  );

  if (snapshots.length === 0) {
    return null;
  }

  // Calculate 7-day averages
  const last7 = snapshots.slice(0, 7);
  const hrv7 = calculateAverage(last7.map(s => s.hrv));
  const rhr7 = calculateAverage(last7.map(s => s.resting_hr));
  const sleep7 = calculateAverage(last7.map(s => s.sleep_hours));

  // Calculate 30-day averages
  const last30 = snapshots.slice(0, 30);
  const hrv30 = calculateAverage(last30.map(s => s.hrv));
  const rhr30 = calculateAverage(last30.map(s => s.resting_hr));
  const sleep30 = calculateAverage(last30.map(s => s.sleep_hours));

  const baseline: ReadinessBaseline = {
    local_date: targetDate,
    hrv_7day_avg: hrv7,
    rhr_7day_avg: rhr7,
    sleep_7day_avg: sleep7,
    hrv_30day_avg: hrv30,
    rhr_30day_avg: rhr30,
    sleep_30day_avg: sleep30,
    computed_at: new Date().toISOString(),
  };

  return baseline;
}

/**
 * Store computed baselines in the database
 */
export function storeBaseline(baseline: ReadinessBaseline): void {
  execute(
    `INSERT OR REPLACE INTO readiness_baselines
     (local_date, hrv_7day_avg, rhr_7day_avg, sleep_7day_avg,
      hrv_30day_avg, rhr_30day_avg, sleep_30day_avg, computed_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      baseline.local_date,
      baseline.hrv_7day_avg,
      baseline.rhr_7day_avg,
      baseline.sleep_7day_avg,
      baseline.hrv_30day_avg,
      baseline.rhr_30day_avg,
      baseline.sleep_30day_avg,
      baseline.computed_at,
    ]
  );
}

/**
 * Get stored baseline for a date
 */
export function getBaseline(targetDate: string): ReadinessBaseline | null {
  const row = queryOne<BaselineRow>(
    'SELECT * FROM readiness_baselines WHERE local_date = ?',
    [targetDate]
  );

  return row ? row : null;
}

/**
 * Get most recent baseline
 */
export function getLatestBaseline(): ReadinessBaseline | null {
  const row = queryOne<BaselineRow>(
    'SELECT * FROM readiness_baselines ORDER BY local_date DESC LIMIT 1'
  );

  return row ? row : null;
}

/**
 * Compute and store baselines for a date range
 */
export function computeBaselinesForRange(startDate: string, endDate: string): number {
  let count = 0;
  let currentDate = new Date(startDate);
  const end = new Date(endDate);

  while (currentDate <= end) {
    const dateStr = currentDate.toISOString().split('T')[0];
    const baseline = computeBaselinesForDate(dateStr);

    if (baseline) {
      storeBaseline(baseline);
      count++;
    }

    currentDate.setDate(currentDate.getDate() + 1);
  }

  return count;
}

/**
 * Compute baselines for all dates with health data (backfill)
 */
export function backfillAllBaselines(): number {
  const dateRange = queryOne<{ min_date: string; max_date: string }>(
    `SELECT MIN(local_date) as min_date, MAX(local_date) as max_date
     FROM health_snapshots`
  );

  if (!dateRange || !dateRange.min_date || !dateRange.max_date) {
    return 0;
  }

  return computeBaselinesForRange(dateRange.min_date, dateRange.max_date);
}

/**
 * Calculate readiness deltas for a specific date
 */
export function calculateReadinessDeltas(targetDate: string): ReadinessDeltas | null {
  // Get today's values
  const today = queryOne<HealthSnapshot>(
    'SELECT local_date, hrv, resting_hr, sleep_hours FROM health_snapshots WHERE local_date = ?',
    [targetDate]
  );

  if (!today) {
    return null;
  }

  // Get or compute baseline
  let baseline = getBaseline(targetDate);
  if (!baseline) {
    baseline = computeBaselinesForDate(targetDate);
    if (baseline) {
      storeBaseline(baseline);
    }
  }

  if (!baseline) {
    return null;
  }

  return {
    local_date: targetDate,
    hrv_value: today.hrv,
    hrv_vs_7day: calculateDelta(today.hrv, baseline.hrv_7day_avg),
    hrv_vs_30day: calculateDelta(today.hrv, baseline.hrv_30day_avg),
    rhr_value: today.resting_hr,
    rhr_vs_7day: calculateDelta(today.resting_hr, baseline.rhr_7day_avg),
    rhr_vs_30day: calculateDelta(today.resting_hr, baseline.rhr_30day_avg),
    sleep_value: today.sleep_hours,
    sleep_vs_7day: calculateDelta(today.sleep_hours, baseline.sleep_7day_avg),
    sleep_vs_30day: calculateDelta(today.sleep_hours, baseline.sleep_30day_avg),
  };
}

/**
 * Get readiness status summary
 */
export function getReadinessStatus(targetDate: string): {
  status: 'optimal' | 'normal' | 'suboptimal' | 'poor' | 'unknown';
  factors: string[];
  score: number;
} {
  const deltas = calculateReadinessDeltas(targetDate);

  if (!deltas) {
    return { status: 'unknown', factors: ['No health data available'], score: 0.5 };
  }

  const factors: string[] = [];
  let score = 0.5; // Start at neutral

  // HRV assessment (higher is better)
  if (deltas.hrv_vs_7day !== null) {
    if (deltas.hrv_vs_7day >= 10) {
      score += 0.15;
      factors.push('HRV well above baseline');
    } else if (deltas.hrv_vs_7day >= 5) {
      score += 0.1;
      factors.push('HRV above baseline');
    } else if (deltas.hrv_vs_7day <= -15) {
      score -= 0.2;
      factors.push('HRV significantly below baseline');
    } else if (deltas.hrv_vs_7day <= -10) {
      score -= 0.15;
      factors.push('HRV below baseline');
    }
  }

  // RHR assessment (lower is better, so inverted)
  if (deltas.rhr_vs_7day !== null) {
    if (deltas.rhr_vs_7day <= -3) {
      score += 0.1;
      factors.push('RHR below baseline');
    } else if (deltas.rhr_vs_7day >= 5) {
      score -= 0.15;
      factors.push('RHR elevated above baseline');
    } else if (deltas.rhr_vs_7day >= 3) {
      score -= 0.1;
      factors.push('RHR slightly elevated');
    }
  }

  // Sleep assessment
  if (deltas.sleep_value !== null) {
    if (deltas.sleep_value >= 8) {
      score += 0.1;
      factors.push('Excellent sleep duration');
    } else if (deltas.sleep_value >= 7) {
      score += 0.05;
      factors.push('Good sleep duration');
    } else if (deltas.sleep_value < 6) {
      score -= 0.15;
      factors.push('Poor sleep duration');
    } else if (deltas.sleep_value < 7) {
      score -= 0.05;
      factors.push('Below optimal sleep');
    }
  }

  // Clamp score between 0 and 1
  score = Math.max(0, Math.min(1, score));

  let status: 'optimal' | 'normal' | 'suboptimal' | 'poor';
  if (score >= 0.7) {
    status = 'optimal';
  } else if (score >= 0.5) {
    status = 'normal';
  } else if (score >= 0.3) {
    status = 'suboptimal';
  } else {
    status = 'poor';
  }

  if (factors.length === 0) {
    factors.push('Metrics within normal range');
  }

  return { status, factors, score };
}

/**
 * Format readiness for display
 */
export function formatReadiness(targetDate: string): string {
  const deltas = calculateReadinessDeltas(targetDate);
  const status = getReadinessStatus(targetDate);

  const lines: string[] = [
    `Readiness for ${targetDate}: ${status.status.toUpperCase()} (${(status.score * 100).toFixed(0)}%)`,
    '',
  ];

  if (deltas) {
    if (deltas.hrv_value !== null) {
      lines.push(`  HRV: ${deltas.hrv_value}ms (${formatDelta(deltas.hrv_vs_7day)} vs 7-day)`);
    }
    if (deltas.rhr_value !== null) {
      lines.push(`  RHR: ${deltas.rhr_value}bpm (${formatDelta(deltas.rhr_vs_7day)} vs 7-day)`);
    }
    if (deltas.sleep_value !== null) {
      lines.push(`  Sleep: ${deltas.sleep_value.toFixed(1)}h (${formatDelta(deltas.sleep_vs_7day)} vs 7-day)`);
    }
    lines.push('');
  }

  lines.push('Factors:');
  status.factors.forEach(f => lines.push(`  - ${f}`));

  return lines.join('\n');
}

// Helper functions

function calculateAverage(values: (number | null)[]): number | null {
  const validValues = values.filter((v): v is number => v !== null);
  if (validValues.length === 0) return null;
  return validValues.reduce((sum, v) => sum + v, 0) / validValues.length;
}

function calculateDelta(current: number | null, baseline: number | null): number | null {
  if (current === null || baseline === null) return null;
  return current - baseline;
}

function formatDelta(delta: number | null): string {
  if (delta === null) return 'N/A';
  const sign = delta >= 0 ? '+' : '';
  return `${sign}${delta.toFixed(1)}`;
}
