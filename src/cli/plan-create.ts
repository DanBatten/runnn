/**
 * Plan Create - Interactive training plan creation CLI
 *
 * Orchestrates the complete flow:
 * 1. Analyze historical data
 * 2. Interactive goal setting
 * 3. Generate multi-block plan
 * 4. Display and confirm
 * 5. Save to database
 */

import chalk from 'chalk';
import enquirer from 'enquirer';
import { isDbInitialized, closeDb, query, insertWithEvent, generateId } from '../db/client.js';
import { analyzeAthlete, formatPace, AthleteAnalysis } from '../coach/athlete-analysis.js';
import { generatePlan, savePlan, TrainingGoal, TrainingPlan } from '../coach/plan-generator.js';
// getRaceDayNutrition available for future race-day planning feature

const { Select, Input, Confirm, MultiSelect } = enquirer as any;

// ===== Main Command =====

export async function planCreateCommand(options?: {
  race?: string;
  date?: string;
  goal?: string;
  quick?: boolean;
}): Promise<void> {
  const dbPath = process.env.DATABASE_PATH ?? './data/coach.db';

  if (!isDbInitialized(dbPath)) {
    console.log(chalk.yellow('Database not initialized'));
    console.log(`Run ${chalk.cyan('runnn init')} to create the database`);
    return;
  }

  console.log('');
  console.log(chalk.bold('═'.repeat(68)));
  console.log(chalk.bold.cyan('                    TRAINING PLAN CREATION'));
  console.log(chalk.bold('═'.repeat(68)));
  console.log('');

  try {
    // Phase 1: Analysis
    console.log(chalk.bold('Phase 1: Analyzing your training history...'));
    console.log('');

    const analysis = analyzeAthlete();
    displayAnalysis(analysis);

    // Check for blocking concerns
    const blockingConcerns = analysis.concerns.filter(c =>
      c.includes('Active injury') || c.includes('No workout history')
    );

    if (blockingConcerns.length > 0 && !options?.quick) {
      console.log(chalk.yellow('Concerns detected:'));
      blockingConcerns.forEach(c => console.log(chalk.yellow(`  ! ${c}`)));
      console.log('');

      const proceed = new Confirm({
        name: 'proceed',
        message: 'Continue with plan creation anyway?',
        initial: false,
      });

      const shouldProceed = await proceed.run();
      if (!shouldProceed) {
        console.log(chalk.gray('Plan creation cancelled.'));
        closeDb();
        return;
      }
    }

    // Phase 2: Goal Setting
    console.log('');
    console.log(chalk.bold('─'.repeat(68)));
    console.log(chalk.bold('Phase 2: Goal Setting'));
    console.log('');

    const goal = await gatherGoals(analysis, options);

    // Validate race date
    const raceDate = new Date(goal.race.date);
    const today = new Date();
    const weeksUntilRace = Math.ceil((raceDate.getTime() - today.getTime()) / (7 * 24 * 60 * 60 * 1000));

    if (weeksUntilRace < 1) {
      console.log(chalk.red('Error: Race date must be in the future'));
      closeDb();
      return;
    }

    if (weeksUntilRace < 4) {
      console.log(chalk.yellow(`Note: Only ${weeksUntilRace} weeks until race - generating abbreviated plan`));
    }

    // Check for existing active plan
    const existingPlan = query<{ id: string; name: string }>(
      "SELECT id, name FROM training_plans WHERE status = 'active' LIMIT 1"
    );

    if (existingPlan.length > 0 && !options?.quick) {
      console.log('');
      console.log(chalk.yellow(`You have an active plan: "${existingPlan[0].name}"`));

      const archive = new Confirm({
        name: 'archive',
        message: 'Archive it and create a new plan?',
        initial: true,
      });

      const shouldArchive = await archive.run();
      if (shouldArchive) {
        insertWithEvent('training_plans', {
          id: existingPlan[0].id,
          status: 'archived',
        }, { source: 'plan_create' });
        console.log(chalk.gray('Previous plan archived.'));
      } else {
        console.log(chalk.gray('Plan creation cancelled.'));
        closeDb();
        return;
      }
    }

    // Phase 3: Generation
    console.log('');
    console.log(chalk.bold('─'.repeat(68)));
    console.log(chalk.bold('Phase 3: Generating Your Plan...'));
    console.log('');

    const plan = generatePlan(analysis, goal);

    // Phase 4: Display
    console.log('');
    console.log(chalk.bold('═'.repeat(68)));
    console.log(chalk.bold.green('                      YOUR TRAINING PLAN'));
    console.log(chalk.bold('═'.repeat(68)));
    console.log('');

    displayPlan(plan);

    // Phase 5: Confirmation
    console.log('');

    if (options?.quick) {
      // Auto-save in quick mode
      savePlan(plan);
      console.log(chalk.green('✓ Plan saved!'));
    } else {
      const savePrompt = new Select({
        name: 'action',
        message: 'Save this plan?',
        choices: [
          { name: 'yes', message: 'Yes, save it' },
          { name: 'no', message: 'Cancel' },
        ],
      });

      const action = await savePrompt.run();

      if (action === 'yes') {
        savePlan(plan);
        saveAthleteKnowledge(goal);
        console.log('');
        console.log(chalk.green('✓ Plan saved!'));
        console.log('');
        console.log('  Next steps:');
        console.log(`  • View this week: ${chalk.cyan('runnn plan week')}`);
        console.log(`  • Morning check: ${chalk.cyan('runnn morning')}`);
        console.log(`  • After runs: ${chalk.cyan('runnn postrun')}`);
      } else {
        console.log(chalk.gray('Plan creation cancelled.'));
      }
    }
  } catch (error: any) {
    if (error.message?.includes('cancelled')) {
      console.log(chalk.gray('\nPlan creation cancelled.'));
    } else {
      console.error(chalk.red('Error creating plan:'), error.message);
    }
  }

  console.log('');
  closeDb();
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
      console.log(chalk.yellow(`  ! ${c}`));
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

// ===== Interactive Goal Setting =====

async function gatherGoals(
  analysis: AthleteAnalysis,
  options?: { race?: string; date?: string; goal?: string; quick?: boolean }
): Promise<TrainingGoal> {
  const distanceMeters: Record<string, number> = {
    marathon: 42195,
    half: 21097.5,
    '10k': 10000,
    '5k': 5000,
  };

  // Quick mode: use provided options with smart defaults
  if (options?.quick && options.race && options.date) {
    // Infer distance from race name
    let distance: 'marathon' | 'half' | '10k' | '5k' = 'half';
    const nameLower = options.race.toLowerCase();
    if (nameLower.includes('marathon') && !nameLower.includes('half')) {
      distance = 'marathon';
    } else if (nameLower.includes('half')) {
      distance = 'half';
    } else if (nameLower.includes('10k')) {
      distance = '10k';
    } else if (nameLower.includes('5k')) {
      distance = '5k';
    }

    // Parse goal time if provided
    let goalTimeSeconds: number | null = null;
    if (options.goal) {
      goalTimeSeconds = parseTime(options.goal);
    }

    console.log(chalk.gray(`  Quick mode: ${distance} on ${options.date}`));
    console.log('');

    return {
      race: {
        name: options.race,
        distance,
        distance_meters: distanceMeters[distance],
        date: options.date,
        goal_time_seconds: goalTimeSeconds,
        priority: 'A',
      },
      constraints: {
        max_days_per_week: 5,
        preferred_long_run_day: 'sunday',
        max_weekly_mileage: null,
        blocked_days: [],
        strength_days: [],
        injury_considerations: [],
      },
      preferences: {
        gradual_build: true,
        quality_focus: 'balanced',
      },
    };
  }

  // Interactive mode: prompt for each setting
  // Race distance
  const distancePrompt = new Select({
    name: 'distance',
    message: 'What race distance are you training for?',
    choices: [
      { name: 'marathon', message: 'Marathon (26.2 mi)' },
      { name: 'half', message: 'Half Marathon (13.1 mi)' },
      { name: '10k', message: '10K (6.2 mi)' },
      { name: '5k', message: '5K (3.1 mi)' },
    ],
  });

  const distance = await distancePrompt.run() as 'marathon' | 'half' | '10k' | '5k';

  // Race name
  const namePrompt = new Input({
    name: 'name',
    message: 'Race name?',
    initial: options?.race || '',
  });

  const raceName = await namePrompt.run();

  // Race date
  const datePrompt = new Input({
    name: 'date',
    message: 'Race date? (YYYY-MM-DD)',
    initial: options?.date || '',
    validate: (value: string) => {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
        return 'Please enter date as YYYY-MM-DD';
      }
      const date = new Date(value);
      if (isNaN(date.getTime())) {
        return 'Invalid date';
      }
      if (date <= new Date()) {
        return 'Race date must be in the future';
      }
      return true;
    },
  });

  const raceDate = await datePrompt.run();

  // Goal time
  const goalTypePrompt = new Select({
    name: 'goalType',
    message: 'What is your goal?',
    choices: [
      { name: 'pr', message: 'PR attempt (push for best time)' },
      { name: 'specific', message: 'Specific finish time' },
      { name: 'finish', message: 'Just finish comfortably' },
    ],
  });

  const goalType = await goalTypePrompt.run();

  let goalTimeSeconds: number | null = null;

  if (goalType === 'specific') {
    const timePrompt = new Input({
      name: 'time',
      message: 'Goal time? (H:MM:SS or MM:SS)',
      initial: options?.goal || '',
      validate: (value: string) => {
        const parts = value.split(':').map(Number);
        if (parts.some(isNaN) || parts.length < 2 || parts.length > 3) {
          return 'Enter time as H:MM:SS or MM:SS';
        }
        return true;
      },
    });

    const timeStr = await timePrompt.run();
    goalTimeSeconds = parseTime(timeStr);
  } else if (goalType === 'pr' && analysis.inferred_capabilities.estimated_half_pace) {
    // Estimate a reasonable goal based on current fitness
    const estPace = distance === 'marathon'
      ? analysis.inferred_capabilities.estimated_marathon_pace
      : distance === 'half'
        ? analysis.inferred_capabilities.estimated_half_pace
        : distance === '10k'
          ? analysis.inferred_capabilities.estimated_10k_pace
          : analysis.inferred_capabilities.estimated_5k_pace;

    if (estPace) {
      goalTimeSeconds = Math.round((distanceMeters[distance] / 1609.344) * estPace);
    }
  }

  // Days per week
  const daysPrompt = new Select({
    name: 'days',
    message: 'How many days per week can you run?',
    choices: [
      { name: '4', message: '4 days (good recovery)' },
      { name: '5', message: '5 days (solid base)' },
      { name: '6', message: '6 days (experienced runner)' },
    ],
  });

  const daysPerWeek = parseInt(await daysPrompt.run());

  // Long run day
  const longRunPrompt = new Select({
    name: 'longRun',
    message: 'Preferred day for long runs?',
    choices: [
      { name: 'sunday', message: 'Sunday' },
      { name: 'saturday', message: 'Saturday' },
    ],
  });

  const longRunDay = await longRunPrompt.run() as 'saturday' | 'sunday';

  // Build preference
  const buildPrompt = new Select({
    name: 'build',
    message: 'Training approach preference?',
    choices: [
      { name: 'gradual', message: 'Gradual (conservative, prioritize consistency)' },
      { name: 'aggressive', message: 'Aggressive (faster progression, higher risk)' },
    ],
  });

  const buildPref = await buildPrompt.run();

  // Constraints
  let blockedDays: string[] = [];
  let strengthDays: string[] = [];

  const hasConstraints = new Confirm({
    name: 'constraints',
    message: 'Do you have schedule constraints or strength training days to consider?',
    initial: false,
  });

  if (await hasConstraints.run()) {
    const blockedPrompt = new MultiSelect({
      name: 'blocked',
      message: 'Any days you CANNOT run? (space to select)',
      choices: ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'],
    });

    blockedDays = (await blockedPrompt.run() as string[]).map(d => d.toLowerCase());

    const strengthPrompt = new MultiSelect({
      name: 'strength',
      message: 'Which days do you do strength training?',
      choices: ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'],
    });

    strengthDays = (await strengthPrompt.run() as string[]).map(d => d.toLowerCase());
  }

  // Injury considerations
  let injuryConsiderations: string[] = [];

  if (analysis.health_profile.injury_history.length > 0) {
    const recentInjuries = analysis.health_profile.injury_history
      .filter(i => i.severity >= 3)
      .map(i => i.location);

    if (recentInjuries.length > 0) {
      console.log(chalk.yellow(`\n  Note: Recent injury history: ${recentInjuries.join(', ')}`));

      const considerInjury = new Confirm({
        name: 'injury',
        message: 'Should we be conservative with these areas?',
        initial: true,
      });

      if (await considerInjury.run()) {
        injuryConsiderations = recentInjuries;
      }
    }
  }

  return {
    race: {
      name: raceName,
      distance,
      distance_meters: distanceMeters[distance],
      date: raceDate,
      goal_time_seconds: goalTimeSeconds,
      priority: 'A',
    },
    constraints: {
      max_days_per_week: daysPerWeek,
      preferred_long_run_day: longRunDay,
      max_weekly_mileage: null,
      blocked_days: blockedDays,
      strength_days: strengthDays,
      injury_considerations: injuryConsiderations,
    },
    preferences: {
      gradual_build: buildPref === 'gradual',
      quality_focus: 'balanced',
    },
  };
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
      query(
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
