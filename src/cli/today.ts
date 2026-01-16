/**
 * Today's Workout Display
 * Shows full workout prescription with health metrics
 */

import chalk from 'chalk';
import { isDbInitialized, query, queryOne, closeDb } from '../db/client.js';
import { getTimezone, getDayName } from '../util/timezone.js';

interface PlannedWorkout {
  id: string;
  local_date: string;
  type: string;
  priority: string;
  target_distance_meters: number;
  prescription: string;
  rationale: string;
}

interface HealthSnapshot {
  local_date: string;
  hrv: number | null;
  hrv_status: string | null;
  resting_hr: number | null;
  sleep_hours: number | null;
  sleep_quality: number | null;
  body_battery: number | null;
  stress_level: number | null;
}

// AthleteKnowledge interface - reserved for future use
// interface AthleteKnowledge { key: string; value: string; }

function formatPace(minutes: number): string {
  const mins = Math.floor(minutes);
  const secs = Math.round((minutes - mins) * 60);
  return `${mins}:${secs.toString().padStart(2, '0')}/mi`;
}

function getWorkoutDetails(type: string, distanceMiles: number) {
  // Generate warmup/cooldown/main set based on workout type
  const details: {
    warmup: string;
    mainSet: string;
    cooldown: string;
    pace: string;
    hrZone: string;
    feel: string;
    nutrition: { pre: string; during: string; post: string };
    ifStruggling: string[];
  } = {
    warmup: '',
    mainSet: '',
    cooldown: '',
    pace: '',
    hrZone: '',
    feel: '',
    nutrition: { pre: '', during: '', post: '' },
    ifStruggling: [],
  };

  switch (type) {
    case 'easy':
      details.warmup = 'Easy jog to loosen up, dynamic stretches (leg swings, hip circles)';
      details.mainSet = `${(distanceMiles - 1).toFixed(0)} miles at easy effort`;
      details.cooldown = 'Easy jog 0.5 mi, static stretching';
      details.pace = '~8:00/mi';
      details.hrZone = 'Zone 2 (130-145 bpm)';
      details.feel = 'Conversational - full sentences easily';
      details.nutrition = {
        pre: 'Optional - water, light snack if hungry',
        during: 'Water only',
        post: 'Normal meal within 1-2 hrs',
      };
      details.ifStruggling = [
        'Legs heavy: Slow to 8:30/mi, no shame',
        'Tired: Cut 1-2 miles, listen to your body',
        'Hot weather: Run early, slow pace 15-20 sec/mi',
      ];
      break;

    case 'tempo':
      const tempoMiles = Math.round(distanceMiles * 0.6);
      details.warmup = '1.5 mi easy jog, then 4x100m strides';
      details.mainSet = `${tempoMiles} miles at tempo effort (${formatPace(6.5)})`;
      details.cooldown = '1 mi easy jog, static stretching';
      details.pace = '~6:30/mi';
      details.hrZone = 'Zone 3-4 (155-170 bpm)';
      details.feel = 'Comfortably hard - short phrases only';
      details.nutrition = {
        pre: 'Light meal 2-3 hrs before (300 cal)',
        during: 'Water only (carry 8-12 oz)',
        post: 'Recovery shake within 30 min (20g protein)',
      };
      details.ifStruggling = [
        'First mile hard: Back off 10-15 sec/mi, reassess',
        'Legs dead: Convert to steady run (7:30-8:00 pace)',
        'Hot: Slow all paces 15-20 sec/mi, shorten tempo portion',
      ];
      break;

    case 'long':
      details.warmup = 'Start easy, first mile is your warmup';
      details.mainSet = `${distanceMiles.toFixed(0)} miles total - see prescription for pace segments`;
      details.cooldown = 'Walk 5 min, stretch thoroughly';
      details.pace = '~7:30-8:00/mi (easy sections), ~6:30/mi (MP sections)';
      details.hrZone = 'Zone 2-3 (135-160 bpm)';
      details.feel = 'Controlled - save energy for MP segments';
      details.nutrition = {
        pre: 'Full meal 3-4 hrs before (500-700 cal)',
        during: 'Gel every 45 min after mile 6, water every 15-20 min',
        post: 'Recovery shake immediately, full meal within 2 hrs',
      };
      details.ifStruggling = [
        'Bonking: Take gel, slow down, shorten if needed',
        'Legs heavy early: Skip MP segments, just finish easy',
        'Weather hot: Start earlier, reduce MP miles, prioritize hydration',
      ];
      break;

    case 'interval':
      details.warmup = '2 mi easy jog with dynamic stretches, 4x100m strides';
      details.mainSet = 'See prescription for interval details';
      details.cooldown = '1.5 mi easy jog, thorough stretching';
      details.pace = '~6:00-6:10/mi for intervals';
      details.hrZone = 'Zone 4-5 during intervals (170-185 bpm)';
      details.feel = 'Hard but controlled - not all-out';
      details.nutrition = {
        pre: 'Light meal 2-3 hrs before (300 cal)',
        during: 'Water between intervals',
        post: 'Recovery shake within 30 min',
      };
      details.ifStruggling = [
        'Can\'t hit paces: Extend recovery, reduce reps',
        'Legs dead: Convert to tempo or steady run',
        'Hot: Move to treadmill or postpone',
      ];
      break;

    default:
      details.warmup = 'Easy jog 0.5-1 mi';
      details.mainSet = `${distanceMiles.toFixed(0)} miles`;
      details.cooldown = 'Easy jog, stretching';
      details.pace = 'As prescribed';
      details.hrZone = 'Varies';
      details.feel = 'As prescribed';
      details.nutrition = {
        pre: 'Light meal if needed',
        during: 'Water as needed',
        post: 'Normal recovery',
      };
      details.ifStruggling = ['Adjust based on feel'];
  }

  return details;
}

function getHRVStatus(hrv: number, recentAvg: number): { status: string; color: typeof chalk.green } {
  const diff = hrv - recentAvg;
  const pctDiff = (diff / recentAvg) * 100;

  if (pctDiff >= 10) return { status: '↑ Above baseline - good recovery', color: chalk.green };
  if (pctDiff >= -5) return { status: '→ Normal - proceed as planned', color: chalk.white };
  if (pctDiff >= -15) return { status: '↓ Below baseline - consider easier effort', color: chalk.yellow };
  return { status: '↓↓ Well below baseline - consider rest', color: chalk.red };
}

function calculateReadiness(health: HealthSnapshot, avgHRV: number | null): number {
  let score = 70; // Start at baseline
  const factors: { name: string; impact: number }[] = [];

  // HRV contribution (most important, up to ±20 points)
  if (health.hrv && avgHRV) {
    const pctDiff = ((health.hrv - avgHRV) / avgHRV) * 100;
    if (pctDiff >= 10) {
      score += 15;
      factors.push({ name: 'HRV above baseline', impact: 15 });
    } else if (pctDiff >= -5) {
      score += 5;
      factors.push({ name: 'HRV normal', impact: 5 });
    } else if (pctDiff >= -15) {
      score -= 10;
      factors.push({ name: 'HRV below baseline', impact: -10 });
    } else {
      score -= 20;
      factors.push({ name: 'HRV well below baseline', impact: -20 });
    }
  }

  // Sleep contribution (up to ±15 points)
  if (health.sleep_hours) {
    if (health.sleep_hours >= 7.5) {
      score += 10;
      factors.push({ name: 'Good sleep duration', impact: 10 });
    } else if (health.sleep_hours >= 6.5) {
      score += 0;
    } else if (health.sleep_hours >= 5.5) {
      score -= 10;
      factors.push({ name: 'Short sleep', impact: -10 });
    } else {
      score -= 15;
      factors.push({ name: 'Very short sleep', impact: -15 });
    }

    // Sleep quality bonus/penalty
    if (health.sleep_quality) {
      if (health.sleep_quality >= 80) {
        score += 5;
      } else if (health.sleep_quality < 50) {
        score -= 5;
      }
    }
  }

  // Body battery contribution (up to ±10 points)
  if (health.body_battery) {
    if (health.body_battery >= 70) {
      score += 10;
      factors.push({ name: 'High body battery', impact: 10 });
    } else if (health.body_battery >= 40) {
      score += 0;
    } else {
      score -= 10;
      factors.push({ name: 'Low body battery', impact: -10 });
    }
  }

  // Stress contribution (up to ±5 points)
  if (health.stress_level) {
    if (health.stress_level <= 25) {
      score += 5;
    } else if (health.stress_level > 50) {
      score -= 5;
      factors.push({ name: 'Elevated stress', impact: -5 });
    }
  }

  // Clamp to 0-100
  return Math.max(0, Math.min(100, score));
}

export async function todayCommand(): Promise<void> {
  const dbPath = process.env.DATABASE_PATH ?? './data/coach.db';

  if (!isDbInitialized(dbPath)) {
    console.log(chalk.yellow('Database not initialized'));
    return;
  }

  // Get current date in athlete's timezone (auto-detected from system)
  const tzInfo = getTimezone();
  const today = tzInfo.localDate;
  const dayName = getDayName(new Date());

  console.log('');
  console.log(chalk.bold('═'.repeat(65)));
  console.log(chalk.bold.cyan(`  TODAY'S RUN - ${dayName}, ${today}`));
  console.log(chalk.bold('═'.repeat(65)));
  console.log('');

  // Get today's workout
  const workout = queryOne<PlannedWorkout>(`
    SELECT pw.* FROM planned_workouts pw
    JOIN training_plans tp ON pw.training_plan_id = tp.id
    WHERE tp.status = 'active' AND pw.local_date = ?
  `, [today]);

  // Get health data
  const todayHealth = queryOne<HealthSnapshot>(
    'SELECT * FROM health_snapshots WHERE local_date = ?',
    [today]
  );

  const recentHealth = query<HealthSnapshot>(`
    SELECT * FROM health_snapshots
    WHERE hrv IS NOT NULL
    ORDER BY local_date DESC LIMIT 7
  `);

  const avgHRV = recentHealth.length > 0
    ? recentHealth.reduce((sum, h) => sum + (h.hrv || 0), 0) / recentHealth.length
    : null;

  // Display health metrics
  console.log(chalk.cyan('  READINESS'));
  console.log(chalk.gray('  ─'.repeat(30)));

  if (todayHealth || recentHealth.length > 0) {
    const latestHealth = todayHealth || recentHealth[0];

    // HRV with trend analysis
    if (latestHealth.hrv) {
      const hrvStatus = avgHRV ? getHRVStatus(latestHealth.hrv, avgHRV) : { status: '', color: chalk.white };
      console.log(`  HRV:        ${chalk.bold(latestHealth.hrv + 'ms')} ${hrvStatus.color(hrvStatus.status)}`);
      if (avgHRV) {
        console.log(chalk.gray(`              7-day avg: ${avgHRV.toFixed(0)}ms`));
      }
    }

    // Resting heart rate with context
    if (latestHealth.resting_hr) {
      const rhrColor = latestHealth.resting_hr <= 50 ? chalk.green :
                       latestHealth.resting_hr <= 60 ? chalk.white : chalk.yellow;
      console.log(`  Resting HR: ${rhrColor(latestHealth.resting_hr + ' bpm')}`);
    }

    // Sleep with quality score
    if (latestHealth.sleep_hours) {
      const sleepColor = latestHealth.sleep_hours >= 7.5 ? chalk.green :
                         latestHealth.sleep_hours >= 6.5 ? chalk.white : chalk.yellow;
      let sleepStr = `${latestHealth.sleep_hours} hrs`;
      if (latestHealth.sleep_quality) {
        sleepStr += ` (quality: ${latestHealth.sleep_quality}/100)`;
      }
      console.log(`  Sleep:      ${sleepColor(sleepStr)}`);
    }

    // Body battery with interpretation
    if (latestHealth.body_battery) {
      const bbColor = latestHealth.body_battery >= 70 ? chalk.green :
                      latestHealth.body_battery >= 40 ? chalk.white : chalk.yellow;
      const bbStatus = latestHealth.body_battery >= 70 ? 'Well charged' :
                       latestHealth.body_battery >= 40 ? 'Moderate' : 'Low - consider easy effort';
      console.log(`  Body Batt:  ${bbColor(latestHealth.body_battery + '%')} ${chalk.gray('(' + bbStatus + ')')}`);
    }

    // Stress level
    if (latestHealth.stress_level) {
      const stressColor = latestHealth.stress_level <= 25 ? chalk.green :
                          latestHealth.stress_level <= 50 ? chalk.white : chalk.yellow;
      const stressStatus = latestHealth.stress_level <= 25 ? 'Relaxed' :
                           latestHealth.stress_level <= 50 ? 'Normal' : 'Elevated';
      console.log(`  Stress:     ${stressColor(latestHealth.stress_level + '/100')} ${chalk.gray('(' + stressStatus + ')')}`);
    }

    // Overall readiness assessment
    const readinessScore = calculateReadiness(latestHealth, avgHRV);
    const readinessColor = readinessScore >= 80 ? chalk.green :
                           readinessScore >= 60 ? chalk.white : chalk.yellow;
    const readinessLabel = readinessScore >= 80 ? 'Excellent - good to go!' :
                           readinessScore >= 60 ? 'Moderate - proceed as planned' : 'Consider easier effort today';
    console.log('');
    console.log(`  ${chalk.bold('READINESS:')} ${readinessColor(readinessScore + '/100')} ${chalk.gray('(' + readinessLabel + ')')}`);

    if (!todayHealth && recentHealth[0]) {
      console.log(chalk.gray(`  (data from ${recentHealth[0].local_date})`));
    }
  } else {
    console.log(chalk.gray('  No health data available - sync Garmin'));
  }

  console.log('');

  // Display workout
  if (!workout) {
    console.log(chalk.yellow('  REST DAY'));
    console.log('');
    console.log('  No run scheduled. Recovery options:');
    console.log('  • Light walk or mobility work');
    console.log('  • Foam rolling and stretching');
    console.log('  • Full rest if fatigued');
    console.log('');
    closeDb();
    return;
  }

  const distanceMiles = workout.target_distance_meters / 1609.344;
  const details = getWorkoutDetails(workout.type, distanceMiles);

  // Get block info
  const block = queryOne<{ name: string; block_type: string }>(`
    SELECT tb.name, tb.block_type FROM training_blocks tb
    JOIN planned_workouts pw ON pw.training_block_id = tb.id
    WHERE pw.id = ?
  `, [workout.id]);

  const priorityLabel = workout.priority === 'A' ? chalk.red('KEY SESSION') :
                        workout.priority === 'B' ? chalk.blue('SUPPORTING') : chalk.gray('OPTIONAL');

  console.log(chalk.cyan(`  ${workout.type.toUpperCase()} RUN`));
  console.log(`  ${priorityLabel} | ${block?.name || 'Training'}`);
  console.log(chalk.gray('  ─'.repeat(30)));
  console.log('');

  // Warmup
  console.log(chalk.bold('  WARMUP'));
  console.log(`  ${details.warmup}`);
  console.log('');

  // Main Set
  console.log(chalk.bold('  MAIN SET'));
  console.log(`  ${workout.prescription}`);
  console.log(`  Pace: ${chalk.cyan(details.pace)} | HR: ${details.hrZone}`);
  console.log(`  Feel: ${details.feel}`);
  console.log('');

  // Cooldown
  console.log(chalk.bold('  COOLDOWN'));
  console.log(`  ${details.cooldown}`);
  console.log('');

  // Total
  const estMinutes = Math.round(distanceMiles * 8);
  console.log(chalk.gray('  ─'.repeat(30)));
  console.log(`  ${chalk.bold('TOTAL:')} ${distanceMiles.toFixed(1)} miles | ~${estMinutes} min`);
  console.log('');

  // Nutrition
  console.log(chalk.cyan('  NUTRITION'));
  console.log(chalk.gray('  ─'.repeat(30)));
  console.log(`  Pre:    ${details.nutrition.pre}`);
  console.log(`  During: ${details.nutrition.during}`);
  console.log(`  Post:   ${details.nutrition.post}`);
  console.log('');

  // Why
  console.log(chalk.cyan('  WHY THIS WORKOUT'));
  console.log(chalk.gray('  ─'.repeat(30)));
  console.log(`  ${workout.rationale || 'Builds aerobic base and maintains consistency.'}`);
  console.log('');

  // If Struggling
  console.log(chalk.cyan('  IF STRUGGLING'));
  console.log(chalk.gray('  ─'.repeat(30)));
  for (const tip of details.ifStruggling) {
    console.log(`  • ${tip}`);
  }
  console.log('');

  closeDb();
}
