/**
 * Plan Create - Non-interactive training plan creation CLI
 *
 * Designed to be called by Claude Code with all parameters provided.
 * Claude handles the conversation, this command handles execution.
 *
 * Usage:
 *   runnn plan create --race "LA Marathon" --date 2026-03-08 --distance marathon --goal 3:30:00
 */

import chalk from 'chalk';
import { isDbInitialized, closeDb, query, execute, insertWithEvent, generateId } from '../db/client.js';
import { analyzeAthlete, formatPace, AthleteAnalysis } from '../coach/athlete-analysis.js';
import { generatePlan, savePlan, TrainingGoal, TrainingPlan } from '../coach/plan-generator.js';

// ===== Types =====

export interface PlanCreateOptions {
  // Required
  race?: string;
  date?: string;
  distance?: string;

  // Optional with defaults
  goal?: string;
  days?: number;
  longRunDay?: string;
  approach?: string;

  // Flags
  analyze?: boolean;  // Just run analysis, don't create plan
  save?: boolean;     // Auto-save without confirmation (default true)
}

// ===== Main Command =====

export async function planCreateCommand(options: PlanCreateOptions = {}): Promise<void> {
  const dbPath = process.env.DATABASE_PATH ?? './data/coach.db';

  if (!isDbInitialized(dbPath)) {
    console.log(chalk.yellow('Database not initialized'));
    console.log(`Run ${chalk.cyan('runnn init')} to create the database`);
    return;
  }

  try {
    // Always run analysis first
    console.log('');
    console.log(chalk.bold('═'.repeat(68)));
    console.log(chalk.bold.cyan('                    TRAINING PLAN CREATION'));
    console.log(chalk.bold('═'.repeat(68)));
    console.log('');

    console.log(chalk.bold('Analyzing your training history...'));
    console.log('');

    const analysis = analyzeAthlete();
    displayAnalysis(analysis);

    // If --analyze flag, stop here
    if (options.analyze) {
      console.log(chalk.gray('Analysis complete. Use options to create a plan.'));
      closeDb();
      return;
    }

    // Validate required options
    if (!options.race || !options.date || !options.distance) {
      console.log(chalk.yellow('Missing required options for plan creation:'));
      if (!options.race) console.log(chalk.yellow('  --race <name>     Race name'));
      if (!options.date) console.log(chalk.yellow('  --date <YYYY-MM-DD>  Race date'));
      if (!options.distance) console.log(chalk.yellow('  --distance <marathon|half|10k|5k>'));
      console.log('');
      console.log(chalk.gray('Example: runnn plan create --race "LA Marathon" --date 2026-03-08 --distance marathon'));
      closeDb();
      return;
    }

    // Validate distance
    const validDistances = ['marathon', 'half', '10k', '5k'];
    if (!validDistances.includes(options.distance)) {
      console.log(chalk.red(`Invalid distance: ${options.distance}`));
      console.log(chalk.gray(`Valid options: ${validDistances.join(', ')}`));
      closeDb();
      return;
    }

    // Validate date
    const raceDate = new Date(options.date);
    const today = new Date();
    if (isNaN(raceDate.getTime())) {
      console.log(chalk.red('Invalid date format. Use YYYY-MM-DD'));
      closeDb();
      return;
    }

    const weeksUntilRace = Math.ceil((raceDate.getTime() - today.getTime()) / (7 * 24 * 60 * 60 * 1000));
    if (weeksUntilRace < 1) {
      console.log(chalk.red('Race date must be in the future'));
      closeDb();
      return;
    }

    if (weeksUntilRace < 4) {
      console.log(chalk.yellow(`Note: Only ${weeksUntilRace} weeks until race - generating abbreviated plan`));
    }

    // Build goal from options
    const goal = buildGoalFromOptions(options, analysis);

    // Check for existing active plan and archive it
    const existingPlan = query<{ id: string; name: string }>(
      "SELECT id, name FROM training_plans WHERE status = 'active' LIMIT 1"
    );

    if (existingPlan.length > 0) {
      console.log(chalk.gray(`Archiving previous plan: "${existingPlan[0].name}"`));
      execute('UPDATE training_plans SET status = ? WHERE id = ?', ['archived', existingPlan[0].id]);
    }

    // Generate plan
    console.log('');
    console.log(chalk.bold('─'.repeat(68)));
    console.log(chalk.bold('Generating Your Plan...'));
    console.log('');

    const plan = generatePlan(analysis, goal);

    // Display plan
    console.log('');
    console.log(chalk.bold('═'.repeat(68)));
    console.log(chalk.bold.green('                      YOUR TRAINING PLAN'));
    console.log(chalk.bold('═'.repeat(68)));
    console.log('');

    displayPlan(plan);

    // Save plan (default behavior)
    if (options.save !== false) {
      savePlan(plan);
      saveAthleteKnowledge(goal);
      console.log(chalk.green('✓ Plan saved!'));
      console.log('');
      console.log('  Next steps:');
      console.log(`  • View this week: ${chalk.cyan('runnn plan week')}`);
      console.log(`  • Morning check: ${chalk.cyan('runnn morning')}`);
      console.log(`  • After runs: ${chalk.cyan('runnn postrun')}`);
    } else {
      console.log(chalk.gray('Plan generated but not saved (--no-save flag)'));
    }

  } catch (error: any) {
    console.error(chalk.red('Error creating plan:'), error.message);
  }

  console.log('');
  closeDb();
}

// ===== Build Goal from Options =====

function buildGoalFromOptions(options: PlanCreateOptions, _analysis: AthleteAnalysis): TrainingGoal {
  const distanceMeters: Record<string, number> = {
    marathon: 42195,
    half: 21097.5,
    '10k': 10000,
    '5k': 5000,
  };

  const distance = options.distance as 'marathon' | 'half' | '10k' | '5k';

  // Parse goal time if provided
  let goalTimeSeconds: number | null = null;
  if (options.goal) {
    goalTimeSeconds = parseTime(options.goal);
  }

  // Validate days per week
  let daysPerWeek = options.days || 5;
  if (daysPerWeek < 3) daysPerWeek = 3;
  if (daysPerWeek > 6) daysPerWeek = 6;

  // Validate long run day
  let longRunDay: 'saturday' | 'sunday' = 'sunday';
  if (options.longRunDay === 'saturday') {
    longRunDay = 'saturday';
  }

  // Validate approach
  const gradualBuild = options.approach !== 'aggressive';

  return {
    race: {
      name: options.race!,
      distance,
      distance_meters: distanceMeters[distance],
      date: options.date!,
      goal_time_seconds: goalTimeSeconds,
      priority: 'A',
    },
    constraints: {
      max_days_per_week: daysPerWeek,
      preferred_long_run_day: longRunDay,
      max_weekly_mileage: null,
      blocked_days: [],
      strength_days: [],
      injury_considerations: [],
    },
    preferences: {
      gradual_build: gradualBuild,
      quality_focus: 'balanced',
    },
  };
}

// ===== Display Functions =====

function displayAnalysis(analysis: AthleteAnalysis): void {
  // Training History
  if (analysis.training_history.total_runs > 0) {
    console.log(chalk.cyan(`  Training History (${analysis.training_history.total_weeks} weeks)`));
    console.log(`  ├── Total runs: ${analysis.training_history.total_runs}`);
    console.log(`  ├── Total mileage: ${analysis.training_history.total_miles} miles`);
    console.log(`  ├── Average weekly: ${analysis.training_history.avg_weekly_miles} miles`);
    console.log(`  ├── Peak week: ${analysis.training_history.peak_weekly_miles} miles`);
    console.log(`  ├── Consistency: ${analysis.training_history.consistency_score}%`);

    const types = Object.entries(analysis.training_history.workout_type_distribution)
      .map(([type, count]) => `${type}: ${count}`)
      .join(', ');
    console.log(`  └── Workout types: ${types || 'none classified'}`);
  } else {
    console.log(chalk.yellow('  No training history found'));
  }
  console.log('');

  // Health Profile
  if (analysis.health_profile.has_health_data) {
    console.log(chalk.cyan('  Health Profile'));
    if (analysis.health_profile.avg_sleep_hours) {
      console.log(`  ├── Average sleep: ${analysis.health_profile.avg_sleep_hours} hours`);
    }
    if (analysis.health_profile.avg_hrv) {
      console.log(`  ├── HRV trend: ${analysis.health_profile.hrv_trend} (avg ${analysis.health_profile.avg_hrv}ms)`);
    }
    const injuries = analysis.health_profile.injury_history.filter(i => !i.resolved);
    console.log(`  └── Active injuries: ${injuries.length === 0 ? 'none' : injuries.map(i => i.location).join(', ')}`);
    console.log('');
  }

  // Biomarkers
  if (analysis.biomarker_insights.has_bloodwork) {
    console.log(chalk.cyan('  Biomarker Status'));
    console.log(`  ├── Iron/Ferritin: ${analysis.biomarker_insights.ferritin_status}`);
    console.log(`  ├── Vitamin D: ${analysis.biomarker_insights.vitamin_d_status}`);
    console.log(`  ├── Inflammation: ${analysis.biomarker_insights.inflammatory_markers}`);
    console.log(`  └── Metabolic: ${analysis.biomarker_insights.metabolic_health}`);
    console.log('');
  }

  // Estimated Paces
  if (analysis.inferred_capabilities.estimated_5k_pace) {
    console.log(chalk.cyan('  Estimated Paces'));
    console.log(`  ├── Easy: ~${formatPace(analysis.inferred_capabilities.estimated_10k_pace! + 75)}/mi`);
    console.log(`  ├── 5K: ~${formatPace(analysis.inferred_capabilities.estimated_5k_pace!)}/mi`);
    console.log(`  ├── Half: ~${formatPace(analysis.inferred_capabilities.estimated_half_pace!)}/mi`);
    console.log(`  └── Confidence: ${analysis.inferred_capabilities.pace_confidence}`);
    console.log('');
  }

  // Recommendations
  if (analysis.recommendations.length > 0) {
    console.log(chalk.cyan('  Recommendations:'));
    analysis.recommendations.forEach(r => {
      console.log(chalk.green(`  • ${r}`));
    });
    console.log('');
  }

  // Concerns
  if (analysis.concerns.length > 0) {
    console.log(chalk.cyan('  Concerns:'));
    analysis.concerns.forEach(c => {
      console.log(chalk.yellow(`  • ${c}`));
    });
    console.log('');
  }
}

function displayPlan(plan: TrainingPlan): void {
  console.log(`  ${chalk.bold('Race:')} ${plan.race.name}`);
  console.log(`  ${chalk.bold('Date:')} ${plan.race.date} (${plan.total_weeks} weeks away)`);
  console.log(`  ${chalk.bold('Distance:')} ${(plan.race.distance_meters / 1609.344).toFixed(1)} miles`);
  if (plan.race.goal_time_seconds) {
    console.log(`  ${chalk.bold('Goal:')} ${formatTime(plan.race.goal_time_seconds)}`);
  }
  console.log(`  ${chalk.bold('Peak mileage:')} ${plan.peak_mileage} miles/week`);
  console.log('');

  console.log(chalk.cyan('  Philosophy:'));
  console.log(`  ${plan.philosophy}`);
  console.log('');

  // Block summary
  console.log(chalk.cyan('  Block Structure:'));
  for (const block of plan.blocks) {
    console.log(`  ${chalk.bold(block.name)} (${block.weeks} weeks)`);
    console.log(`    ${block.focus}`);
    console.log(`    ${block.start_date} → ${block.end_date}`);
  }
  console.log('');

  // Weekly overview table
  console.log(chalk.cyan('  Weekly Overview:'));
  console.log('  ┌──────┬────────┬───────┬─────────────────────────┬──────────────┐');
  console.log('  │ Week │ Block  │ Miles │ Key Session             │ Long Run     │');
  console.log('  ├──────┼────────┼───────┼─────────────────────────┼──────────────┤');

  let weekNum = 1;
  for (const block of plan.blocks) {
    for (const week of block.weekly_plans) {
      const blockLabel = block.type.toUpperCase().substring(0, 6).padEnd(6);
      const miles = week.target_miles.toFixed(0).padStart(5);

      const longRun = week.workouts.find(w => w.type === 'long');
      const longRunStr = longRun
        ? `${(longRun.target_distance_meters / 1609.344).toFixed(0)}mi ${week.is_recovery_week ? '(rec)' : 'easy'}`
        : 'Rest';

      const keySession = week.key_session.substring(0, 23).padEnd(23);

      // Special handling for race week
      const isRaceWeek = weekNum === plan.total_weeks;
      const longRunDisplay = isRaceWeek ? 'RACE DAY!   ' : longRunStr.padEnd(12);

      console.log(`  │ ${weekNum.toString().padStart(4)} │ ${blockLabel} │${miles} │ ${keySession} │ ${longRunDisplay} │`);
      weekNum++;
    }
  }

  console.log('  └──────┴────────┴───────┴─────────────────────────┴──────────────┘');
  console.log('');

  // Mileage chart (ASCII)
  displayMileageChart(plan);
}

function displayMileageChart(plan: TrainingPlan): void {
  console.log(chalk.cyan('  Mileage Progression:'));

  const allWeeks = plan.blocks.flatMap(b => b.weekly_plans);
  const maxMiles = Math.max(...allWeeks.map(w => w.target_miles));
  const chartWidth = 40;

  for (const week of allWeeks) {
    const barWidth = Math.round((week.target_miles / maxMiles) * chartWidth);
    const bar = '█'.repeat(barWidth) + '░'.repeat(chartWidth - barWidth);
    const label = week.target_miles.toFixed(0).padStart(3);
    console.log(`  ${label} mi │${bar}│`);
  }

  console.log('');
}

// ===== Knowledge Persistence =====

function saveAthleteKnowledge(goal: TrainingGoal): void {
  const entries = [
    { key: 'preferred_long_run_day', value: goal.constraints.preferred_long_run_day },
    { key: 'max_days_per_week', value: goal.constraints.max_days_per_week.toString() },
    { key: 'build_preference', value: goal.preferences.gradual_build ? 'gradual' : 'aggressive' },
  ];

  if (goal.constraints.strength_days.length > 0) {
    entries.push({ key: 'strength_days', value: JSON.stringify(goal.constraints.strength_days) });
  }

  if (goal.constraints.injury_considerations.length > 0) {
    entries.push({ key: 'injury_sensitivities', value: JSON.stringify(goal.constraints.injury_considerations) });
  }

  for (const entry of entries) {
    // Upsert knowledge entry
    const existing = query<{ id: string }>(
      'SELECT id FROM athlete_knowledge WHERE key = ?',
      [entry.key]
    );

    if (existing.length > 0) {
      execute(
        'UPDATE athlete_knowledge SET value = ?, last_confirmed_at = datetime("now") WHERE key = ?',
        [entry.value, entry.key]
      );
    } else {
      insertWithEvent('athlete_knowledge', {
        id: generateId(),
        type: 'preference',
        category: 'training',
        key: entry.key,
        value: entry.value,
        source: 'stated',
        confidence: 1.0,
        evidence_count: 1,
        is_active: 1,
      }, { source: 'plan_create' });
    }
  }
}

// ===== Utility Functions =====

function formatTime(seconds: number): string {
  const hours = Math.floor(seconds / 3600);
  const mins = Math.floor((seconds % 3600) / 60);
  const secs = Math.floor(seconds % 60);

  if (hours > 0) {
    return `${hours}:${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  }
  return `${mins}:${secs.toString().padStart(2, '0')}`;
}

function parseTime(timeStr: string): number {
  const parts = timeStr.split(':').map(Number);

  if (parts.length === 3) {
    return parts[0] * 3600 + parts[1] * 60 + parts[2];
  } else if (parts.length === 2) {
    return parts[0] * 60 + parts[1];
  }

  return 0;
}
