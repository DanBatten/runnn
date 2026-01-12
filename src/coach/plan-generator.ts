/**
 * Plan Generator - Multi-block training plan generation
 *
 * Generates complete training plans with:
 * - Periodization (base → build → peak → taper)
 * - Weekly templates with workout distribution
 * - Nutrition and recovery guidance
 * - Race-specific preparation
 */

import { generateId, execute, insertWithEvent, query } from '../db/client.js';
import { AthleteAnalysis, formatPace } from './athlete-analysis.js';
import { getWorkoutNutrition } from './nutrition-guidelines.js';
import { generateRestDayPlan } from './recovery-routines.js';

// ===== Types =====

export interface TrainingGoal {
  race: {
    name: string;
    distance: 'marathon' | 'half' | '10k' | '5k' | 'custom';
    distance_meters: number;
    date: string;
    goal_time_seconds: number | null;
    priority: 'A' | 'B' | 'C';
  };
  constraints: {
    max_days_per_week: number;
    preferred_long_run_day: 'saturday' | 'sunday';
    max_weekly_mileage: number | null;
    blocked_days: string[];
    strength_days: string[];
    injury_considerations: string[];
  };
  preferences: {
    gradual_build: boolean;
    quality_focus: 'speed' | 'endurance' | 'balanced';
  };
}

export interface TrainingPlan {
  id: string;
  name: string;
  start_date: string;
  end_date: string;
  race: TrainingGoal['race'];
  blocks: TrainingBlock[];
  total_weeks: number;
  peak_mileage: number;
  philosophy: string;
}

export interface TrainingBlock {
  id: string;
  name: string;
  type: 'base' | 'build' | 'peak' | 'taper' | 'recovery';
  start_date: string;
  end_date: string;
  weeks: number;
  focus: string;
  weekly_plans: WeeklyPlan[];
}

export interface WeeklyPlan {
  week_number: number;
  start_date: string;
  target_miles: number;
  is_recovery_week: boolean;
  workouts: PlannedWorkout[];
  rest_days: RestDay[];
  key_session: string;
  notes: string;
}

export interface PlannedWorkout {
  id: string;
  local_date: string;
  day_of_week: string;
  type: string;
  priority: 'A' | 'B' | 'C';
  target_distance_meters: number;
  target_duration_seconds: number | null;
  warmup: { distance_meters: number; description: string };
  main_set: { description: string; distance_meters: number };
  cooldown: { distance_meters: number; description: string };
  target_pace: {
    sec_per_mile: number | null;
    description: string;
    hr_zone: string | null;
  };
  nutrition: ReturnType<typeof getWorkoutNutrition>;
  prescription: string;
  rationale: string;
  if_struggling: string;
}

export interface RestDay {
  local_date: string;
  day_of_week: string;
  plan: ReturnType<typeof generateRestDayPlan>;
}

// ===== Constants =====

const METERS_PER_MILE = 1609.344;

const DAYS_OF_WEEK = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];

// Distance lookup reserved for race pacing calculations
// const DISTANCE_METERS: Record<string, number> = {
//   '5k': 5000,
//   '10k': 10000,
//   'half': 21097.5,
//   'marathon': 42195,
// };

// Periodization templates by total weeks
const PERIODIZATION_TEMPLATES: Record<number, { base: number; build: number; peak: number; taper: number }> = {
  8: { base: 3, build: 3, peak: 1, taper: 1 },
  10: { base: 3, build: 4, peak: 2, taper: 1 },
  12: { base: 4, build: 4, peak: 2, taper: 2 },
  14: { base: 4, build: 5, peak: 3, taper: 2 },
  16: { base: 5, build: 5, peak: 3, taper: 3 },
  18: { base: 5, build: 6, peak: 4, taper: 3 },
  20: { base: 6, build: 6, peak: 5, taper: 3 },
};

// ===== Main Generation Functions =====

/**
 * Generate a complete training plan
 */
export function generatePlan(
  analysis: AthleteAnalysis,
  goal: TrainingGoal
): TrainingPlan {
  const raceDate = new Date(goal.race.date);
  const today = new Date();
  const weeksUntilRace = Math.ceil((raceDate.getTime() - today.getTime()) / (7 * 24 * 60 * 60 * 1000));

  // Validate race date
  if (weeksUntilRace < 1) {
    throw new Error('Race date must be in the future');
  }

  // Calculate plan parameters
  const totalWeeks = Math.min(weeksUntilRace, 20);
  const startDate = getNextMonday(today);
  const endDate = addDays(startDate, totalWeeks * 7 - 1);

  // Determine starting and peak mileage
  const currentMileage = analysis.training_history.avg_weekly_miles || 15;
  const peakMileage = calculatePeakMileage(goal, currentMileage, totalWeeks, analysis);

  // Get periodization structure
  const periodization = getPeriodization(totalWeeks);

  // Generate philosophy statement
  const philosophy = generatePhilosophy(goal, analysis, periodization);

  // Generate blocks
  const blocks = generateBlocks(
    periodization,
    startDate,
    currentMileage,
    peakMileage,
    goal,
    analysis
  );

  const planId = generateId();

  return {
    id: planId,
    name: `${goal.race.name} Training Plan`,
    start_date: startDate,
    end_date: endDate,
    race: goal.race,
    blocks,
    total_weeks: totalWeeks,
    peak_mileage: peakMileage,
    philosophy,
  };
}

/**
 * Calculate peak weekly mileage based on goal and current fitness
 */
function calculatePeakMileage(
  goal: TrainingGoal,
  currentMileage: number,
  totalWeeks: number,
  _analysis: AthleteAnalysis
): number {
  // Base targets by race distance
  const targetByDistance: Record<string, number> = {
    '5k': 35,
    '10k': 45,
    'half': 50,
    'marathon': 55,
  };

  const baseTarget = targetByDistance[goal.race.distance] || 40;

  // Adjust based on current fitness
  let target = baseTarget;

  // If already running high mileage, can aim higher
  if (currentMileage > baseTarget * 0.8) {
    target = Math.min(currentMileage * 1.3, baseTarget * 1.4);
  }

  // If low mileage history, be conservative
  if (currentMileage < 20) {
    target = Math.min(target, currentMileage + totalWeeks * 2);
  }

  // Respect max mileage constraint
  if (goal.constraints.max_weekly_mileage) {
    target = Math.min(target, goal.constraints.max_weekly_mileage);
  }

  // Gradual build preference
  if (goal.preferences.gradual_build) {
    target = Math.min(target, currentMileage * 1.5);
  }

  // Limit based on available days
  const maxPerDay = goal.race.distance === 'marathon' ? 12 : 10;
  target = Math.min(target, goal.constraints.max_days_per_week * maxPerDay);

  return Math.round(target);
}

/**
 * Get periodization structure for given number of weeks
 */
function getPeriodization(totalWeeks: number): { base: number; build: number; peak: number; taper: number } {
  // Find closest template
  const templateWeeks = Object.keys(PERIODIZATION_TEMPLATES).map(Number).sort((a, b) => a - b);
  let closest = templateWeeks[0];

  for (const w of templateWeeks) {
    if (w <= totalWeeks) closest = w;
  }

  const template = PERIODIZATION_TEMPLATES[closest];

  // Scale to actual weeks
  const scale = totalWeeks / closest;

  return {
    base: Math.round(template.base * scale),
    build: Math.round(template.build * scale),
    peak: Math.round(template.peak * scale),
    taper: Math.max(1, totalWeeks - Math.round(template.base * scale) - Math.round(template.build * scale) - Math.round(template.peak * scale)),
  };
}

/**
 * Generate training blocks
 */
function generateBlocks(
  periodization: ReturnType<typeof getPeriodization>,
  startDate: string,
  startMileage: number,
  peakMileage: number,
  goal: TrainingGoal,
  analysis: AthleteAnalysis
): TrainingBlock[] {
  const blocks: TrainingBlock[] = [];
  let currentDate = startDate;
  let weekNumber = 1;

  // Base phase
  if (periodization.base > 0) {
    const baseMileageStart = startMileage;
    const baseMileageEnd = startMileage + (peakMileage - startMileage) * 0.4;

    blocks.push(generateBlock(
      'base',
      periodization.base,
      currentDate,
      baseMileageStart,
      baseMileageEnd,
      weekNumber,
      goal,
      analysis
    ));
    currentDate = addDays(currentDate, periodization.base * 7);
    weekNumber += periodization.base;
  }

  // Build phase
  if (periodization.build > 0) {
    const buildMileageStart = startMileage + (peakMileage - startMileage) * 0.4;
    const buildMileageEnd = peakMileage;

    blocks.push(generateBlock(
      'build',
      periodization.build,
      currentDate,
      buildMileageStart,
      buildMileageEnd,
      weekNumber,
      goal,
      analysis
    ));
    currentDate = addDays(currentDate, periodization.build * 7);
    weekNumber += periodization.build;
  }

  // Peak phase
  if (periodization.peak > 0) {
    blocks.push(generateBlock(
      'peak',
      periodization.peak,
      currentDate,
      peakMileage,
      peakMileage * 0.9,
      weekNumber,
      goal,
      analysis
    ));
    currentDate = addDays(currentDate, periodization.peak * 7);
    weekNumber += periodization.peak;
  }

  // Taper phase
  if (periodization.taper > 0) {
    const taperStart = peakMileage * 0.8;
    const taperEnd = peakMileage * 0.4;

    blocks.push(generateBlock(
      'taper',
      periodization.taper,
      currentDate,
      taperStart,
      taperEnd,
      weekNumber,
      goal,
      analysis
    ));
  }

  return blocks;
}

/**
 * Generate a single training block
 */
function generateBlock(
  type: 'base' | 'build' | 'peak' | 'taper',
  weeks: number,
  startDate: string,
  mileageStart: number,
  mileageEnd: number,
  startWeekNumber: number,
  goal: TrainingGoal,
  analysis: AthleteAnalysis
): TrainingBlock {
  const blockId = generateId();
  const endDate = addDays(startDate, weeks * 7 - 1);

  const focus = getBlockFocus(type, goal.race.distance);
  const weeklyPlans: WeeklyPlan[] = [];

  for (let w = 0; w < weeks; w++) {
    const weekStartDate = addDays(startDate, w * 7);
    const weekNumber = startWeekNumber + w;

    // Calculate week mileage with progression
    const progress = weeks > 1 ? w / (weeks - 1) : 0;
    let weekMileage = mileageStart + (mileageEnd - mileageStart) * progress;

    // Recovery week every 4th week
    const isRecoveryWeek = (weekNumber % 4 === 0) && type !== 'taper';
    if (isRecoveryWeek) {
      weekMileage *= 0.65;
    }

    const weekPlan = generateWeekPlan(
      weekNumber,
      weekStartDate,
      weekMileage,
      isRecoveryWeek,
      type,
      goal,
      analysis
    );

    weeklyPlans.push(weekPlan);
  }

  return {
    id: blockId,
    name: `${capitalizeFirst(type)} Phase`,
    type,
    start_date: startDate,
    end_date: endDate,
    weeks,
    focus,
    weekly_plans: weeklyPlans,
  };
}

/**
 * Generate a weekly plan
 */
function generateWeekPlan(
  weekNumber: number,
  startDate: string,
  targetMiles: number,
  isRecoveryWeek: boolean,
  blockType: 'base' | 'build' | 'peak' | 'taper',
  goal: TrainingGoal,
  analysis: AthleteAnalysis
): WeeklyPlan {
  const workouts: PlannedWorkout[] = [];
  const restDays: RestDay[] = [];

  // Get estimated paces
  const easyPace = analysis.inferred_capabilities.estimated_10k_pace
    ? analysis.inferred_capabilities.estimated_10k_pace + 75
    : null;
  const tempoPace = analysis.inferred_capabilities.estimated_10k_pace
    ? analysis.inferred_capabilities.estimated_10k_pace + 15
    : null;
  const thresholdPace = analysis.inferred_capabilities.estimated_10k_pace
    ? analysis.inferred_capabilities.estimated_10k_pace
    : null;

  // Workout distribution by phase
  const distribution = getWorkoutDistribution(blockType, isRecoveryWeek);

  // Calculate distances
  const longRunMiles = targetMiles * distribution.long_pct;
  const qualityMiles = targetMiles * distribution.quality_pct;
  const easyTotalMiles = targetMiles - longRunMiles - qualityMiles;
  const easyRunMiles = easyTotalMiles / Math.max(1, goal.constraints.max_days_per_week - 2);

  // Determine run days
  const longRunDay = goal.constraints.preferred_long_run_day;
  const longRunDayIndex = DAYS_OF_WEEK.indexOf(longRunDay);

  // Quality session day (typically Wednesday or Tuesday)
  const qualityDayIndex = longRunDayIndex === 0 ? 3 : 2; // Wed or Tue

  // Build week schedule
  const runDays: number[] = [];
  const restDayIndices: number[] = [];

  // Always include long run and quality session (if applicable)
  runDays.push(longRunDayIndex);
  if (distribution.quality_pct > 0 && !isRecoveryWeek) {
    runDays.push(qualityDayIndex);
  }

  // Fill in easy runs
  const remainingDays = goal.constraints.max_days_per_week - runDays.length;
  const candidateEasyDays = [1, 4, 5].filter(d =>
    !runDays.includes(d) && !goal.constraints.blocked_days.includes(DAYS_OF_WEEK[d])
  );

  for (let i = 0; i < Math.min(remainingDays, candidateEasyDays.length); i++) {
    runDays.push(candidateEasyDays[i]);
  }

  runDays.sort((a, b) => a - b);

  // Rest days are non-run days
  for (let d = 0; d < 7; d++) {
    if (!runDays.includes(d)) {
      restDayIndices.push(d);
    }
  }

  // Generate workouts
  for (let d = 0; d < 7; d++) {
    const dayDate = addDays(startDate, d);
    const dayName = DAYS_OF_WEEK[d];

    if (runDays.includes(d)) {
      let workoutType: string;
      let workoutMiles: number;
      let priority: 'A' | 'B' | 'C';

      if (d === longRunDayIndex) {
        workoutType = 'long';
        workoutMiles = longRunMiles;
        priority = 'A';
      } else if (d === qualityDayIndex && distribution.quality_pct > 0 && !isRecoveryWeek) {
        workoutType = getQualityWorkoutType(blockType);
        workoutMiles = qualityMiles;
        priority = 'A';
      } else {
        workoutType = 'easy';
        workoutMiles = easyRunMiles;
        priority = workouts.length === 0 ? 'B' : 'C';
      }

      const workout = generateWorkout(
        dayDate,
        dayName,
        workoutType,
        workoutMiles,
        priority,
        easyPace,
        tempoPace,
        thresholdPace,
        blockType,
        goal
      );

      workouts.push(workout);
    } else {
      // Rest day
      const prevWorkoutType = workouts.length > 0 ? workouts[workouts.length - 1].type : null;
      const nextDayIndex = (d + 1) % 7;
      const nextIsRun = runDays.includes(nextDayIndex);
      let nextWorkoutType: string | null = null;

      if (nextIsRun) {
        if (nextDayIndex === longRunDayIndex) nextWorkoutType = 'long';
        else if (nextDayIndex === qualityDayIndex && distribution.quality_pct > 0) {
          nextWorkoutType = getQualityWorkoutType(blockType);
        }
        else nextWorkoutType = 'easy';
      }

      const restPlan = generateRestDayPlan(
        dayName,
        prevWorkoutType,
        nextWorkoutType,
        0, // Would need to track this
        []
      );

      restDays.push({
        local_date: dayDate,
        day_of_week: dayName,
        plan: restPlan,
      });
    }
  }

  // Determine key session
  const keyWorkout = workouts.find(w => w.priority === 'A' && w.type !== 'easy');
  const keySession = keyWorkout
    ? `${capitalizeFirst(keyWorkout.type)} - ${(keyWorkout.target_distance_meters / METERS_PER_MILE).toFixed(1)} mi`
    : 'Long run';

  // Week notes
  let notes = '';
  if (isRecoveryWeek) {
    notes = 'Recovery week - reduced volume for adaptation';
  } else if (blockType === 'taper') {
    notes = 'Taper week - focus on freshness and sharpness';
  }

  return {
    week_number: weekNumber,
    start_date: startDate,
    target_miles: Math.round(targetMiles * 10) / 10,
    is_recovery_week: isRecoveryWeek,
    workouts,
    rest_days: restDays,
    key_session: keySession,
    notes,
  };
}

/**
 * Generate a single workout
 */
function generateWorkout(
  date: string,
  dayOfWeek: string,
  type: string,
  miles: number,
  priority: 'A' | 'B' | 'C',
  easyPace: number | null,
  tempoPace: number | null,
  thresholdPace: number | null,
  blockType: string,
  goal: TrainingGoal
): PlannedWorkout {
  const distanceMeters = miles * METERS_PER_MILE;
  const durationMinutes = miles * (easyPace ? easyPace / 60 : 9);

  // Calculate warmup/cooldown for quality sessions
  let warmupMeters = 0;
  let cooldownMeters = 0;
  let mainMeters = distanceMeters;

  if (['tempo', 'threshold', 'interval', 'steady'].includes(type)) {
    warmupMeters = Math.min(2 * METERS_PER_MILE, distanceMeters * 0.2);
    cooldownMeters = Math.min(1.5 * METERS_PER_MILE, distanceMeters * 0.15);
    mainMeters = distanceMeters - warmupMeters - cooldownMeters;
  }

  // Determine target pace
  let targetPace: number | null = null;
  let paceDescription = '';
  let hrZone: string | null = null;

  switch (type) {
    case 'easy':
    case 'long':
      targetPace = easyPace;
      paceDescription = 'Conversational pace - can speak in full sentences';
      hrZone = 'Zone 2 (60-70% max HR)';
      break;
    case 'steady':
      targetPace = easyPace ? easyPace - 30 : null;
      paceDescription = 'Comfortably moderate - can speak in short phrases';
      hrZone = 'Zone 3 (70-80% max HR)';
      break;
    case 'tempo':
      targetPace = tempoPace;
      paceDescription = 'Comfortably hard - can speak a few words at a time';
      hrZone = 'Zone 3-4 (80-88% max HR)';
      break;
    case 'threshold':
      targetPace = thresholdPace;
      paceDescription = 'Hard but controlled - at the edge of comfortable';
      hrZone = 'Zone 4 (88-92% max HR)';
      break;
    case 'interval':
      targetPace = thresholdPace ? thresholdPace - 15 : null;
      paceDescription = 'Hard effort with recovery between reps';
      hrZone = 'Zone 4-5 (90-95% max HR during intervals)';
      break;
  }

  // Generate prescription
  const prescription = generatePrescription(type, miles, mainMeters / METERS_PER_MILE, targetPace, easyPace);

  // Generate rationale
  const rationale = generateRationale(type, blockType, goal.race.distance);

  // Generate backup plan
  const ifStruggling = generateBackupPlan(type, easyPace);

  // Get nutrition
  const nutrition = getWorkoutNutrition(type, durationMinutes, miles, false);

  return {
    id: generateId(),
    local_date: date,
    day_of_week: dayOfWeek,
    type,
    priority,
    target_distance_meters: Math.round(distanceMeters),
    target_duration_seconds: Math.round(durationMinutes * 60),
    warmup: {
      distance_meters: Math.round(warmupMeters),
      description: warmupMeters > 0 ? 'Easy jog with dynamic stretches' : 'None - start easy and build',
    },
    main_set: {
      description: prescription,
      distance_meters: Math.round(mainMeters),
    },
    cooldown: {
      distance_meters: Math.round(cooldownMeters),
      description: cooldownMeters > 0 ? 'Easy jog, then static stretching' : 'Walk and stretch',
    },
    target_pace: {
      sec_per_mile: targetPace,
      description: paceDescription,
      hr_zone: hrZone,
    },
    nutrition,
    prescription,
    rationale,
    if_struggling: ifStruggling,
  };
}

// ===== Helper Functions =====

function getBlockFocus(type: 'base' | 'build' | 'peak' | 'taper', distance: string): string {
  const focuses: Record<string, Record<string, string>> = {
    base: {
      marathon: 'Aerobic foundation and mileage building',
      half: 'Aerobic base development',
      '10k': 'Aerobic conditioning',
      '5k': 'Aerobic endurance',
    },
    build: {
      marathon: 'Threshold development and marathon-pace work',
      half: 'Tempo and threshold training',
      '10k': 'VO2max and threshold work',
      '5k': 'Speed and threshold development',
    },
    peak: {
      marathon: 'Race-specific long runs and sharpening',
      half: 'Race-pace work and fine-tuning',
      '10k': 'Race-specific speed and sharpening',
      '5k': 'Speed sharpening and race simulation',
    },
    taper: {
      marathon: 'Recovery and freshness for race day',
      half: 'Sharpening and recovery',
      '10k': 'Final tune-up and rest',
      '5k': 'Fresh legs for race day',
    },
  };

  return focuses[type]?.[distance] || focuses[type]?.['half'] || 'General fitness';
}

function getWorkoutDistribution(
  blockType: 'base' | 'build' | 'peak' | 'taper',
  isRecoveryWeek: boolean
): { long_pct: number; quality_pct: number; easy_pct: number } {
  if (isRecoveryWeek) {
    return { long_pct: 0.20, quality_pct: 0, easy_pct: 0.80 };
  }

  switch (blockType) {
    case 'base':
      return { long_pct: 0.25, quality_pct: 0.10, easy_pct: 0.65 };
    case 'build':
      return { long_pct: 0.25, quality_pct: 0.20, easy_pct: 0.55 };
    case 'peak':
      return { long_pct: 0.22, quality_pct: 0.25, easy_pct: 0.53 };
    case 'taper':
      return { long_pct: 0.15, quality_pct: 0.15, easy_pct: 0.70 };
    default:
      return { long_pct: 0.25, quality_pct: 0.15, easy_pct: 0.60 };
  }
}

function getQualityWorkoutType(blockType: 'base' | 'build' | 'peak' | 'taper'): string {
  switch (blockType) {
    case 'base':
      return 'steady';
    case 'build':
      return 'tempo';
    case 'peak':
      return 'threshold';
    case 'taper':
      return 'steady';
    default:
      return 'tempo';
  }
}

function generatePrescription(
  type: string,
  totalMiles: number,
  mainMiles: number,
  pace: number | null,
  easyPace: number | null
): string {
  const paceStr = pace ? formatPace(pace) : 'comfortable';

  switch (type) {
    case 'easy':
      return `${totalMiles.toFixed(1)} miles at easy/conversational pace${easyPace ? ` (${formatPace(easyPace)}-${formatPace(easyPace + 30)}/mi)` : ''}`;
    case 'long':
      return `${totalMiles.toFixed(1)} miles at easy pace. Focus on time on feet, not pace.`;
    case 'steady':
      return `Warmup 1-2 mi easy, then ${mainMiles.toFixed(1)} mi steady at ${paceStr}/mi, cooldown 1 mi`;
    case 'tempo':
      return `Warmup 2 mi easy, then ${mainMiles.toFixed(1)} mi tempo at ${paceStr}/mi, cooldown 1 mi`;
    case 'threshold':
      return `Warmup 2 mi easy, then ${mainMiles.toFixed(1)} mi threshold at ${paceStr}/mi, cooldown 1 mi`;
    case 'interval':
      const reps = Math.floor(mainMiles * 2);
      return `Warmup 2 mi easy, then ${reps}x800m at ${paceStr}/mi with 400m jog recovery, cooldown 1 mi`;
    default:
      return `${totalMiles.toFixed(1)} miles`;
  }
}

function generateRationale(type: string, _blockType: string, _distance: string): string {
  const rationales: Record<string, string> = {
    easy: 'Recovery and aerobic maintenance - builds endurance without adding stress',
    long: 'Builds aerobic endurance and mental toughness for race distance',
    steady: 'Develops aerobic efficiency at a moderate effort',
    tempo: 'Improves lactate threshold - the pace you can sustain for about an hour',
    threshold: 'Race-specific threshold work - builds ability to hold goal pace',
    interval: 'Develops VO2max and running economy at faster-than-race pace',
  };

  return rationales[type] || 'General fitness development';
}

function generateBackupPlan(type: string, easyPace: number | null): string {
  const easyStr = easyPace ? formatPace(easyPace + 30) : '9:30';

  switch (type) {
    case 'easy':
    case 'long':
      return `If legs are heavy, slow down 15-30 sec/mi. Walking breaks are OK on long runs.`;
    case 'steady':
      return `If struggling, convert to easy run at ${easyStr}/mi. Quality over quantity.`;
    case 'tempo':
      return `First 2 mi feel hard? Back off 10-15 sec/mi. Legs heavy? Convert to steady run.`;
    case 'threshold':
      return `If can't hold pace, back off to tempo effort. Hot weather? Slow 15-20 sec/mi.`;
    case 'interval':
      return `If reps feel too hard, extend recovery or reduce pace. Better to finish than bail.`;
    default:
      return `Listen to your body. Adjust pace or duration as needed.`;
  }
}

function generatePhilosophy(
  goal: TrainingGoal,
  analysis: AthleteAnalysis,
  periodization: ReturnType<typeof getPeriodization>
): string {
  const distanceName = goal.race.distance === 'half' ? 'half marathon' : goal.race.distance;
  const baseWeeks = periodization.base;
  const buildWeeks = periodization.build;

  let philosophy = `This ${distanceName} plan builds progressively over ${baseWeeks + buildWeeks + periodization.peak + periodization.taper} weeks. `;

  if (analysis.training_history.avg_weekly_miles < 20) {
    philosophy += `Given your current base, we start conservatively and build gradually. `;
  } else {
    philosophy += `Building on your solid foundation, we'll increase quality work progressively. `;
  }

  if (goal.preferences.gradual_build) {
    philosophy += `The gradual approach prioritizes consistency over aggressive mileage jumps. `;
  }

  philosophy += `Key focus: ${baseWeeks} weeks of base building, ${buildWeeks} weeks of threshold development, then race-specific preparation and taper.`;

  return philosophy;
}

// ===== Persistence Functions =====

/**
 * Save a training plan to the database
 */
export function savePlan(plan: TrainingPlan): void {
  // Insert training plan
  insertWithEvent('training_plans', {
    id: plan.id,
    name: plan.name,
    start_local_date: plan.start_date,
    end_local_date: plan.end_date,
    primary_goal: `${plan.race.name} (${plan.race.distance})`,
    goal_time_seconds: plan.race.goal_time_seconds,
    status: 'active',
    notes: plan.philosophy,
  }, { source: 'plan_create' });

  // Insert race if not exists
  const existingRace = query<{ id: string }>(
    'SELECT id FROM races WHERE name = ? AND race_date = ?',
    [plan.race.name, plan.race.date]
  );

  if (existingRace.length === 0) {
    insertWithEvent('races', {
      id: generateId(),
      name: plan.race.name,
      distance_meters: plan.race.distance_meters,
      race_date: plan.race.date,
      priority: plan.race.priority,
      goal_time_seconds: plan.race.goal_time_seconds,
      training_plan_id: plan.id,
    }, { source: 'plan_create' });
  }

  // Insert training blocks and workouts
  for (const block of plan.blocks) {
    insertWithEvent('training_blocks', {
      id: block.id,
      training_plan_id: plan.id,
      name: block.name,
      block_type: block.type,
      start_local_date: block.start_date,
      end_local_date: block.end_date,
      focus: block.focus,
      weekly_target_miles: block.weekly_plans[0]?.target_miles ?? 0,
    }, { source: 'plan_create' });

    // Insert workouts
    for (const week of block.weekly_plans) {
      for (const workout of week.workouts) {
        execute(
          `INSERT INTO planned_workouts
           (id, training_plan_id, training_block_id, local_date, type, priority,
            target_distance_meters, target_duration_seconds, prescription, rationale, status)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            workout.id,
            plan.id,
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
      }
    }
  }
}

// ===== Utility Functions =====

function getNextMonday(date: Date): string {
  const d = new Date(date);
  const dayOfWeek = d.getDay();
  const daysUntilMonday = dayOfWeek === 0 ? 1 : 8 - dayOfWeek;
  d.setDate(d.getDate() + daysUntilMonday);
  return d.toISOString().split('T')[0];
}

function addDays(date: string, days: number): string {
  const d = new Date(date);
  d.setDate(d.getDate() + days);
  return d.toISOString().split('T')[0];
}

function capitalizeFirst(str: string): string {
  return str.charAt(0).toUpperCase() + str.slice(1);
}
