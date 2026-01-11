/**
 * Plan Generate Block - Generate a training block based on goals and tests
 *
 * Uses:
 * - Goal race (distance, date, target time)
 * - Recent fitness tests
 * - Pace zones
 * - Current training load
 * - Active policies and overrides
 */

import chalk from 'chalk';
import { isDbInitialized, closeDb, generateId, execute } from '../db/client.js';
import { getGoalRace, daysUntilRace } from '../coach/races.js';
import { getCurrentPaceZones } from '../coach/pace-zones.js';
import { getActiveOverrides, getWeeklyMileageLimit, getWeeklyRunsLimit, isWorkoutTypeBlocked } from '../coach/overrides.js';
import { loadContext } from '../coach/context.js';

interface TrainingBlock {
  id: string;
  name: string;
  block_type: 'base' | 'build' | 'peak' | 'taper' | 'recovery';
  start_date: string;
  end_date: string;
  focus: string;
  weekly_target_miles: number;
}

interface PlannedWorkout {
  local_date: string;
  type: string;
  priority: 'A' | 'B' | 'C';
  target_distance_meters: number | null;
  target_duration_seconds: number | null;
  prescription: string;
  rationale: string;
}

export async function planBlockCommand(options?: {
  weeks?: number;
  startDate?: string;
  targetMileage?: number;
}): Promise<void> {
  const dbPath = process.env.DATABASE_PATH ?? './data/coach.db';

  if (!isDbInitialized(dbPath)) {
    console.log(chalk.yellow('Database not initialized'));
    console.log(`Run ${chalk.cyan('runnn init')} to create the database`);
    return;
  }

  console.log(chalk.bold('Generating Training Block'));
  console.log('');

  // Get goal race
  const goalRace = getGoalRace();
  if (goalRace) {
    const days = daysUntilRace(goalRace);
    console.log(chalk.cyan(`Goal Race: ${goalRace.name}`));
    console.log(`  Distance: ${(goalRace.distance_meters / 1609.344).toFixed(1)} miles`);
    console.log(`  Date: ${goalRace.race_date} (${days} days)`);
    if (goalRace.goal_time_seconds) {
      console.log(`  Goal: ${formatTime(goalRace.goal_time_seconds)}`);
    }
    console.log('');
  } else {
    console.log(chalk.yellow('No goal race set - generating general fitness block'));
    console.log('');
  }

  // Get current context
  const context = loadContext();
  const currentWeeklyMiles = context.weekly_mileage / 1609.344;

  console.log(chalk.cyan('Current Status:'));
  console.log(`  Weekly mileage: ${currentWeeklyMiles.toFixed(1)} miles`);
  console.log(`  Recent workouts: ${context.recent_workouts.length}`);
  console.log('');

  // Get pace zones
  const paceZones = getCurrentPaceZones();
  if (paceZones) {
    console.log(chalk.cyan('Pace Zones:'));
    if (paceZones.easy_pace_low && paceZones.easy_pace_high) {
      console.log(`  Easy: ${formatPace(paceZones.easy_pace_high)} - ${formatPace(paceZones.easy_pace_low)}/mi`);
    }
    if (paceZones.tempo_pace_low && paceZones.tempo_pace_high) {
      console.log(`  Tempo: ${formatPace(paceZones.tempo_pace_high)} - ${formatPace(paceZones.tempo_pace_low)}/mi`);
    }
    if (paceZones.threshold_pace) {
      console.log(`  Threshold: ${formatPace(paceZones.threshold_pace)}/mi`);
    }
    console.log('');
  } else {
    console.log(chalk.yellow('No pace zones set - run a fitness test first'));
    console.log('');
  }

  // Check overrides
  const overrides = getActiveOverrides();
  if (overrides.length > 0) {
    console.log(chalk.cyan('Active Overrides:'));
    for (const override of overrides) {
      console.log(`  - ${override.description}`);
    }
    console.log('');
  }

  // Determine block parameters
  const numWeeks = options?.weeks ?? 4;
  const startDate = options?.startDate ?? getNextMonday();
  const targetMileage = options?.targetMileage ?? calculateTargetMileage(currentWeeklyMiles, goalRace, numWeeks);

  // Check mileage limits from overrides
  const mileageLimit = getWeeklyMileageLimit();
  const runsLimit = getWeeklyRunsLimit();

  const effectiveTargetMileage = mileageLimit ? Math.min(targetMileage, mileageLimit) : targetMileage;

  // Determine block type based on race proximity
  let blockType: TrainingBlock['block_type'] = 'base';
  let blockFocus = 'Aerobic development';

  if (goalRace) {
    const days = daysUntilRace(goalRace);
    if (days <= 14) {
      blockType = 'taper';
      blockFocus = 'Race preparation and recovery';
    } else if (days <= 28) {
      blockType = 'peak';
      blockFocus = 'Race-specific sharpening';
    } else if (days <= 56) {
      blockType = 'build';
      blockFocus = 'Build fitness and race pace work';
    } else {
      blockType = 'base';
      blockFocus = 'Aerobic base building';
    }
  }

  // Generate the block
  console.log(chalk.bold.green(`Generating ${numWeeks}-week ${blockType} block`));
  console.log(`Focus: ${blockFocus}`);
  console.log(`Target weekly mileage: ${effectiveTargetMileage.toFixed(0)} miles`);
  console.log('');

  // Create the training block
  const block = createTrainingBlock({
    name: `${capitalizeFirst(blockType)} Block - Week of ${startDate}`,
    block_type: blockType,
    start_date: startDate,
    num_weeks: numWeeks,
    weekly_target_miles: effectiveTargetMileage,
    focus: blockFocus,
  });

  // Generate weekly plans
  const allWorkouts: PlannedWorkout[] = [];

  for (let week = 0; week < numWeeks; week++) {
    const weekStart = addDays(startDate, week * 7);
    const weekMileage = calculateWeekMileage(effectiveTargetMileage, week, numWeeks, blockType);

    console.log(chalk.cyan(`Week ${week + 1} (${weekStart}):`));
    console.log(`  Target: ${weekMileage.toFixed(0)} miles`);

    const weekWorkouts = generateWeekWorkouts(
      weekStart,
      weekMileage,
      blockType,
      runsLimit ?? 6,
      paceZones
    );

    for (const workout of weekWorkouts) {
      // Check if workout type is blocked
      if (isWorkoutTypeBlocked(workout.type)) {
        console.log(chalk.yellow(`  Skipping ${workout.type} (blocked by override)`));
        continue;
      }

      allWorkouts.push(workout);
      const distance = workout.target_distance_meters
        ? `${(workout.target_distance_meters / 1609.344).toFixed(1)}mi`
        : 'TBD';
      console.log(`  ${workout.local_date}: ${workout.type} [${workout.priority}] - ${distance}`);
    }
    console.log('');
  }

  // Save workouts to database
  console.log(chalk.bold('Saving planned workouts...'));
  let savedCount = 0;

  for (const workout of allWorkouts) {
    const workoutId = generateId();
    execute(
      `INSERT INTO planned_workouts
       (id, training_block_id, local_date, type, priority, target_distance_meters, target_duration_seconds, prescription, rationale, status)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        workoutId,
        block.id,
        workout.local_date,
        workout.type,
        workout.priority,
        workout.target_distance_meters,
        workout.target_duration_seconds,
        workout.prescription,
        workout.rationale,
        'planned',
      ]
    );
    savedCount++;
  }

  console.log(chalk.green(`✓ Saved ${savedCount} planned workouts`));
  console.log('');
  console.log(`View your plan: ${chalk.cyan('runnn plan week')}`);

  closeDb();
}

function createTrainingBlock(params: {
  name: string;
  block_type: TrainingBlock['block_type'];
  start_date: string;
  num_weeks: number;
  weekly_target_miles: number;
  focus: string;
}): { id: string } {
  const id = generateId();
  const endDate = addDays(params.start_date, params.num_weeks * 7 - 1);

  // Use execute directly to handle NULL foreign keys properly
  execute(
    `INSERT INTO training_blocks (id, name, block_type, start_local_date, end_local_date, focus, weekly_target_miles)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [id, params.name, params.block_type, params.start_date, endDate, params.focus, params.weekly_target_miles]
  );

  return { id };
}

function generateWeekWorkouts(
  weekStart: string,
  weekMileage: number,
  blockType: TrainingBlock['block_type'],
  maxRuns: number,
  paceZones: ReturnType<typeof getCurrentPaceZones>
): PlannedWorkout[] {
  const workouts: PlannedWorkout[] = [];

  // Determine workout distribution based on block type
  let longRunPct = 0.25;
  let qualityPct = 0.20;

  switch (blockType) {
    case 'base':
      longRunPct = 0.25;
      qualityPct = 0.10;
      break;
    case 'build':
      longRunPct = 0.25;
      qualityPct = 0.20;
      break;
    case 'peak':
      longRunPct = 0.20;
      qualityPct = 0.25;
      break;
    case 'taper':
      longRunPct = 0.15;
      qualityPct = 0.15;
      break;
    case 'recovery':
      longRunPct = 0.15;
      qualityPct = 0;
      break;
  }

  const runsNeeded = Math.min(maxRuns, Math.ceil(weekMileage / 5)); // ~5 miles per run average

  // Sunday: Long run
  const longRunMiles = weekMileage * longRunPct;
  workouts.push({
    local_date: addDays(weekStart, 6), // Sunday
    type: 'long',
    priority: 'A',
    target_distance_meters: longRunMiles * 1609.344,
    target_duration_seconds: null,
    prescription: `Long run at easy pace${paceZones?.easy_pace_low ? ` (${formatPace(paceZones.easy_pace_low)}-${formatPace(paceZones.easy_pace_high!)}/mi)` : ''}`,
    rationale: 'Weekly long run for aerobic development',
  });

  // Quality session (Tuesday or Wednesday)
  if (qualityPct > 0 && blockType !== 'recovery') {
    const qualityMiles = weekMileage * qualityPct;
    const qualityType = blockType === 'peak' ? 'threshold' : (blockType === 'build' ? 'tempo' : 'steady');

    workouts.push({
      local_date: addDays(weekStart, 2), // Wednesday
      type: qualityType,
      priority: 'A',
      target_distance_meters: qualityMiles * 1609.344,
      target_duration_seconds: null,
      prescription: getQualityPrescription(qualityType, qualityMiles, paceZones),
      rationale: getQualityRationale(qualityType, blockType),
    });
  }

  // Fill remaining days with easy runs
  const usedMileage = longRunMiles + (qualityPct > 0 ? weekMileage * qualityPct : 0);
  const remainingMileage = weekMileage - usedMileage;
  const easyRunsNeeded = Math.max(1, runsNeeded - workouts.length);
  const easyRunMiles = remainingMileage / easyRunsNeeded;

  // Monday, Thursday, Saturday for easy runs
  const easyDays = [1, 4, 5].slice(0, easyRunsNeeded);
  for (let i = 0; i < easyDays.length; i++) {
    workouts.push({
      local_date: addDays(weekStart, easyDays[i]),
      type: 'easy',
      priority: i === 0 ? 'B' : 'C',
      target_distance_meters: easyRunMiles * 1609.344,
      target_duration_seconds: null,
      prescription: `Easy run at conversational pace${paceZones?.easy_pace_low ? ` (${formatPace(paceZones.easy_pace_low)}-${formatPace(paceZones.easy_pace_high!)}/mi)` : ''}`,
      rationale: 'Recovery and aerobic maintenance',
    });
  }

  // Rest days: Tuesday (or Friday if no quality), Friday
  // (implicit - no workouts scheduled)

  return workouts.sort((a, b) => a.local_date.localeCompare(b.local_date));
}

function getQualityPrescription(
  type: string,
  miles: number,
  paceZones: ReturnType<typeof getCurrentPaceZones>
): string {
  const warmup = Math.min(2, miles * 0.2);
  const cooldown = Math.min(1.5, miles * 0.15);
  const mainMiles = miles - warmup - cooldown;

  let mainPace = '';
  if (paceZones) {
    switch (type) {
      case 'tempo':
        if (paceZones.tempo_pace_low) mainPace = ` at ${formatPace(paceZones.tempo_pace_high!)}-${formatPace(paceZones.tempo_pace_low)}/mi`;
        break;
      case 'threshold':
        if (paceZones.threshold_pace) mainPace = ` at ${formatPace(paceZones.threshold_pace)}/mi`;
        break;
      case 'steady':
        if (paceZones.steady_pace_low) mainPace = ` at ${formatPace(paceZones.steady_pace_high!)}-${formatPace(paceZones.steady_pace_low)}/mi`;
        break;
    }
  }

  return `${warmup.toFixed(1)}mi warmup, ${mainMiles.toFixed(1)}mi ${type}${mainPace}, ${cooldown.toFixed(1)}mi cooldown`;
}

function getQualityRationale(type: string, _blockType: string): string {
  switch (type) {
    case 'tempo':
      return 'Tempo work to improve lactate threshold';
    case 'threshold':
      return 'Threshold work for race-specific fitness';
    case 'steady':
      return 'Steady state aerobic development';
    default:
      return 'Quality session for fitness development';
  }
}

function calculateTargetMileage(
  currentMileage: number,
  goalRace: ReturnType<typeof getGoalRace>,
  weeks: number
): number {
  // Start from current mileage
  let target = Math.max(currentMileage, 20); // Minimum 20 miles/week

  // Add 10% ramp per week (max)
  const maxRamp = 1.10;
  target = target * Math.pow(maxRamp, weeks / 4); // Gradual ramp over block

  // Cap based on race distance
  if (goalRace) {
    const raceMiles = goalRace.distance_meters / 1609.344;
    if (raceMiles <= 6.2) {
      // 5K-10K: max ~40-50 miles/week
      target = Math.min(target, 50);
    } else if (raceMiles <= 13.1) {
      // Half marathon: max ~50-60 miles/week
      target = Math.min(target, 60);
    } else {
      // Marathon+: max ~70-80 miles/week
      target = Math.min(target, 80);
    }
  } else {
    // No race: cap at 50
    target = Math.min(target, 50);
  }

  return target;
}

function calculateWeekMileage(
  targetMileage: number,
  weekNum: number,
  totalWeeks: number,
  blockType: TrainingBlock['block_type']
): number {
  // Build up over the block with periodic cutback weeks
  const isRecoveryWeek = (weekNum + 1) % 4 === 0;

  if (blockType === 'taper') {
    // Taper: reduce each week
    return targetMileage * (1 - weekNum * 0.15);
  }

  if (isRecoveryWeek) {
    // Recovery week: 60-70% of target
    return targetMileage * 0.65;
  }

  // Progressive build
  const progression = 0.85 + (weekNum / totalWeeks) * 0.15;
  return targetMileage * progression;
}

function getNextMonday(): string {
  const today = new Date();
  const dayOfWeek = today.getDay();
  const daysUntilMonday = dayOfWeek === 0 ? 1 : 8 - dayOfWeek;
  const nextMonday = new Date(today);
  nextMonday.setDate(today.getDate() + daysUntilMonday);
  return nextMonday.toISOString().split('T')[0];
}

function addDays(date: string, days: number): string {
  const d = new Date(date);
  d.setDate(d.getDate() + days);
  return d.toISOString().split('T')[0];
}

function formatTime(seconds: number): string {
  const hours = Math.floor(seconds / 3600);
  const mins = Math.floor((seconds % 3600) / 60);
  const secs = Math.floor(seconds % 60);

  if (hours > 0) {
    return `${hours}:${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  }
  return `${mins}:${secs.toString().padStart(2, '0')}`;
}

function formatPace(secPerMile: number): string {
  const mins = Math.floor(secPerMile / 60);
  const secs = Math.floor(secPerMile % 60);
  return `${mins}:${secs.toString().padStart(2, '0')}`;
}

function capitalizeFirst(str: string): string {
  return str.charAt(0).toUpperCase() + str.slice(1);
}
