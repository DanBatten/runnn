/**
 * Recovery Routines - Rest day and stretching guidance
 *
 * Provides:
 * - Rest day types and activities
 * - Stretching routines (daily, mobility)
 * - Active recovery options
 * - Strength training integration
 */

// ===== Types =====

export type RestDayType = 'full_rest' | 'active_recovery' | 'cross_train';

export interface RestDayPlan {
  type: RestDayType;
  stretching: {
    routine: 'basic' | 'full_mobility' | 'targeted';
    focus_areas: string[];
    duration_min: number;
  };
  optional_activity: {
    type: string;
    duration_min: number;
    intensity: string;
  } | null;
  why: string;
  nutrition_notes: string;
  tomorrow_preview: string | null;
}

export interface StretchingRoutine {
  name: string;
  duration_min: number;
  exercises: StretchExercise[];
}

export interface StretchExercise {
  name: string;
  duration: string;
  reps?: number;
  notes?: string;
}

// ===== Stretching Routines =====

/**
 * Daily post-run stretching routine (10-15 min)
 */
export function getPostRunStretches(): StretchingRoutine {
  return {
    name: 'Post-Run Stretches',
    duration_min: 12,
    exercises: [
      // Lower body
      { name: 'Standing quad stretch', duration: '30-60 sec each leg' },
      { name: 'Kneeling hip flexor stretch', duration: '30-60 sec each side' },
      { name: 'Pigeon pose (or figure-4 stretch)', duration: '60 sec each side' },
      { name: 'Calf stretch (straight leg)', duration: '30 sec each side' },
      { name: 'Calf stretch (bent knee)', duration: '30 sec each side' },
      { name: 'Standing hamstring stretch', duration: '30-60 sec each leg' },
      // Hip & glute
      { name: '90/90 hip stretch', duration: '45 sec each side' },
      { name: 'Lying glute stretch', duration: '30 sec each side' },
      // Upper body
      { name: 'Chest doorway stretch', duration: '30 sec' },
      { name: 'Cross-body shoulder stretch', duration: '20 sec each arm' },
      { name: 'Cat-cow spine mobility', duration: '10 slow reps' },
    ],
  };
}

/**
 * Full mobility routine for rest days (20-30 min)
 */
export function getFullMobilityRoutine(): StretchingRoutine {
  return {
    name: 'Rest Day Mobility Flow',
    duration_min: 25,
    exercises: [
      // Warm-up (5 min)
      { name: 'Light walk or marching in place', duration: '2-3 min' },
      { name: 'Arm circles', duration: '10 each direction' },
      { name: 'Hip circles', duration: '10 each direction' },
      { name: 'Leg swings (front-back)', duration: '10 each leg' },
      { name: 'Leg swings (side-to-side)', duration: '10 each leg' },
      // Lower body mobility (10 min)
      { name: 'Deep squat hold', duration: '2 min cumulative (break as needed)' },
      { name: 'Couch stretch / hip flexor', duration: '90 sec each side' },
      { name: 'Pigeon pose', duration: '90 sec each side' },
      { name: 'Ankle circles', duration: '20 each direction, each ankle' },
      { name: 'Calf raises', duration: '20 slow reps' },
      // Spine & core (5 min)
      { name: 'Cat-cow', duration: '10 slow reps' },
      { name: 'Thread the needle', duration: '8 each side' },
      { name: 'Dead bug', duration: '10 each side' },
      { name: 'Bird dog', duration: '8 each side' },
    ],
  };
}

/**
 * Foam rolling routine (optional add-on, 10 min)
 */
export function getFoamRollingRoutine(): StretchingRoutine {
  return {
    name: 'Foam Rolling',
    duration_min: 10,
    exercises: [
      { name: 'Quads', duration: '1 min each leg', notes: 'Roll slowly, pause on tender spots' },
      { name: 'IT band', duration: '1 min each side', notes: 'Can be intense - go slowly' },
      { name: 'Glutes', duration: '1 min each side', notes: 'Cross leg over for deeper pressure' },
      { name: 'Calves', duration: '1 min each leg', notes: 'Cross legs for more pressure' },
      { name: 'Upper back', duration: '2 min', notes: 'Arms crossed, roll thoracic spine' },
    ],
  };
}

/**
 * Targeted stretching based on focus areas
 */
export function getTargetedStretches(focusAreas: string[]): StretchingRoutine {
  const exercises: StretchExercise[] = [];

  for (const area of focusAreas) {
    switch (area.toLowerCase()) {
      case 'hip flexors':
      case 'hips':
        exercises.push(
          { name: 'Kneeling hip flexor stretch', duration: '90 sec each side' },
          { name: 'Couch stretch', duration: '60 sec each side' },
          { name: 'Lizard pose', duration: '60 sec each side' }
        );
        break;
      case 'calves':
        exercises.push(
          { name: 'Wall calf stretch (straight leg)', duration: '60 sec each side' },
          { name: 'Wall calf stretch (bent knee)', duration: '60 sec each side' },
          { name: 'Downward dog pedaling', duration: '60 sec' }
        );
        break;
      case 'glutes':
        exercises.push(
          { name: 'Pigeon pose', duration: '90 sec each side' },
          { name: 'Figure-4 stretch', duration: '60 sec each side' },
          { name: 'Seated twist', duration: '45 sec each side' }
        );
        break;
      case 'hamstrings':
        exercises.push(
          { name: 'Standing forward fold', duration: '60 sec' },
          { name: 'Seated forward fold', duration: '60 sec' },
          { name: 'Lying hamstring stretch with strap', duration: '60 sec each leg' }
        );
        break;
      case 'quads':
        exercises.push(
          { name: 'Standing quad stretch', duration: '60 sec each leg' },
          { name: 'Prone quad stretch', duration: '60 sec each leg' }
        );
        break;
      case 'lower back':
      case 'back':
        exercises.push(
          { name: 'Child\'s pose', duration: '60 sec' },
          { name: 'Cat-cow', duration: '10 slow reps' },
          { name: 'Knee-to-chest stretch', duration: '45 sec each side' },
          { name: 'Supine twist', duration: '60 sec each side' }
        );
        break;
      default:
        // General stretches
        exercises.push(
          { name: 'Full body stretch sequence', duration: '5 min' }
        );
    }
  }

  return {
    name: `Targeted Stretching: ${focusAreas.join(', ')}`,
    duration_min: Math.min(20, exercises.length * 2),
    exercises,
  };
}

// ===== Active Recovery Options =====

export interface ActiveRecoveryOption {
  name: string;
  description: string;
  duration_min: number;
  activities: string[];
  notes: string;
}

/**
 * Get active recovery options
 */
export function getActiveRecoveryOptions(): ActiveRecoveryOption[] {
  return [
    {
      name: 'Easy Walk + Mobility',
      description: 'Light movement to promote blood flow followed by mobility work',
      duration_min: 45,
      activities: [
        '20-30 min easy walk (can be outdoors or treadmill)',
        'Full mobility routine (see above)',
      ],
      notes: 'Best option for day after hard workout. Keeps body moving without adding stress.',
    },
    {
      name: 'Swimming / Pool',
      description: 'Low-impact aquatic recovery',
      duration_min: 40,
      activities: [
        '20-30 min easy swimming or pool running',
        '10 min stretching afterward',
      ],
      notes: 'Excellent for active recovery - zero impact, gentle on joints.',
    },
    {
      name: 'Cycling / Spin',
      description: 'Low-impact cardio on the bike',
      duration_min: 45,
      activities: [
        '30-40 min very easy cycling (HR < 120 bpm)',
        'Keep cadence high (85-95 rpm), resistance low',
        'Light stretching afterward',
      ],
      notes: 'Good option if you enjoy cycling. Keep it truly easy - this is recovery.',
    },
    {
      name: 'Yoga',
      description: 'Gentle yoga focused on runners\' needs',
      duration_min: 45,
      activities: [
        '30-45 min gentle/restorative yoga',
        'Focus on hip openers and hamstring stretches',
        'Avoid power yoga or hot yoga on recovery days',
      ],
      notes: 'Great for both physical and mental recovery. Choose "gentle" or "yin" classes.',
    },
  ];
}

// ===== Rest Day Planning =====

/**
 * Generate a rest day plan based on context
 */
export function generateRestDayPlan(
  _dayOfWeek: string,
  previousWorkoutType: string | null,
  nextWorkoutType: string | null,
  recentHighIntensityDays: number,
  focusAreas: string[] = []
): RestDayPlan {
  // Determine rest day type
  let type: RestDayType = 'active_recovery';
  let why = 'Active recovery to promote blood flow and maintain mobility';

  // Full rest if:
  // - After very hard workout (long run, race)
  // - Multiple consecutive hard days
  // - Before key workout (save energy)
  if (previousWorkoutType === 'long' || previousWorkoutType === 'race') {
    type = 'full_rest';
    why = 'Full rest after demanding effort to allow muscle repair';
  } else if (recentHighIntensityDays >= 3) {
    type = 'full_rest';
    why = 'Full rest after multiple hard days to prevent overtraining';
  } else if (nextWorkoutType && ['tempo', 'threshold', 'interval', 'race'].includes(nextWorkoutType)) {
    type = 'active_recovery';
    why = 'Light recovery before tomorrow\'s key session';
  }

  // Determine stretching routine
  let routine: 'basic' | 'full_mobility' | 'targeted' = 'full_mobility';
  let stretchDuration = 20;

  if (type === 'full_rest') {
    routine = 'basic';
    stretchDuration = 15;
  } else if (focusAreas.length > 0) {
    routine = 'targeted';
    stretchDuration = 15;
  }

  // Default focus areas based on previous workout
  if (focusAreas.length === 0) {
    if (previousWorkoutType === 'long') {
      focusAreas = ['hip flexors', 'glutes', 'calves'];
    } else if (previousWorkoutType === 'tempo' || previousWorkoutType === 'threshold') {
      focusAreas = ['hamstrings', 'calves', 'lower back'];
    } else if (previousWorkoutType === 'interval') {
      focusAreas = ['quads', 'hip flexors', 'calves'];
    } else {
      focusAreas = ['hip flexors', 'glutes', 'calves'];
    }
  }

  // Optional activity
  let optionalActivity: RestDayPlan['optional_activity'] = null;
  if (type === 'active_recovery') {
    optionalActivity = {
      type: 'walk or yoga',
      duration_min: 20,
      intensity: 'very easy - keep HR below 120',
    };
  }

  // Nutrition notes
  let nutritionNotes = 'Normal eating day - maintain hydration';
  if (previousWorkoutType === 'long') {
    nutritionNotes = 'Continue hydrating, consider extra carbs for glycogen replenishment';
  } else if (nextWorkoutType && ['tempo', 'threshold', 'interval'].includes(nextWorkoutType)) {
    nutritionNotes = 'Hydrate well, consider slightly more carbs for tomorrow\'s session';
  }

  // Tomorrow preview
  let tomorrowPreview: string | null = null;
  if (nextWorkoutType) {
    tomorrowPreview = `${capitalizeFirst(nextWorkoutType)} run scheduled - ${
      nextWorkoutType === 'easy' ? 'recovery focus' :
      ['tempo', 'threshold', 'interval'].includes(nextWorkoutType) ? 'key session' :
      nextWorkoutType === 'long' ? 'long run day' : 'scheduled run'
    }`;
  }

  return {
    type,
    stretching: {
      routine,
      focus_areas: focusAreas,
      duration_min: stretchDuration,
    },
    optional_activity: optionalActivity,
    why,
    nutrition_notes: nutritionNotes,
    tomorrow_preview: tomorrowPreview,
  };
}

// ===== Strength Training Integration =====

export interface StrengthGuidance {
  recommendation: 'yes' | 'light' | 'avoid';
  focus: string;
  notes: string;
}

/**
 * Get strength training guidance based on running schedule
 */
export function getStrengthGuidance(
  todayWorkoutType: string | null,
  tomorrowWorkoutType: string | null,
  daysSinceLastStrength: number
): StrengthGuidance {
  // Avoid heavy legs before long run or quality session
  if (tomorrowWorkoutType && ['long', 'tempo', 'threshold', 'interval', 'race'].includes(tomorrowWorkoutType)) {
    return {
      recommendation: 'avoid',
      focus: 'Upper body only if needed',
      notes: 'Save legs for tomorrow\'s key session',
    };
  }

  // Day after hard workout: light core only
  if (todayWorkoutType && ['long', 'tempo', 'threshold', 'interval', 'race'].includes(todayWorkoutType)) {
    return {
      recommendation: 'light',
      focus: 'Core and upper body',
      notes: 'Lower body needs recovery - stick to core work and upper body',
    };
  }

  // Easy run day: good for strength
  if (todayWorkoutType === 'easy' || todayWorkoutType === null) {
    if (daysSinceLastStrength >= 3) {
      return {
        recommendation: 'yes',
        focus: 'Full body or lower body focus',
        notes: 'Good day for strength work - run first if doubling',
      };
    } else if (daysSinceLastStrength >= 2) {
      return {
        recommendation: 'light',
        focus: 'Core and mobility',
        notes: 'Light session OK - focus on movement quality',
      };
    }
  }

  return {
    recommendation: 'light',
    focus: 'Core and mobility',
    notes: 'Listen to your body - prioritize recovery if fatigued',
  };
}

/**
 * Sample week template with strength integration
 */
export function getSampleWeekWithStrength(): string {
  return `
SAMPLE WEEK WITH STRENGTH

Mon: Easy run AM + Upper body PM
Tue: REST (mobility + stretching)
Wed: Tempo run (key session)
Thu: Light strength (core focus)
Fri: Easy run
Sat: Lower body strength (moderate)
Sun: Long run (key session)

NOTES:
• Run before strength when doubling
• Heavy legs at least 48 hrs before key sessions
• Core work is always OK
• Skip strength if legs are tired
`.trim();
}

// ===== Formatting Functions =====

/**
 * Format a rest day plan for display
 */
export function formatRestDayPlan(plan: RestDayPlan, dayLabel: string): string {
  const lines: string[] = [];

  lines.push(`REST DAY - ${dayLabel}`);
  lines.push(`Type: ${formatRestDayType(plan.type)}`);
  lines.push('');
  lines.push('PURPOSE');
  lines.push(`  ${plan.why}`);
  lines.push('');

  lines.push(`STRETCHING (${plan.stretching.duration_min} min)`);
  lines.push(`  Focus areas: ${plan.stretching.focus_areas.join(', ')}`);

  if (plan.stretching.routine === 'full_mobility') {
    const routine = getFullMobilityRoutine();
    routine.exercises.slice(0, 5).forEach(ex => {
      lines.push(`  □ ${ex.name} (${ex.duration})`);
    });
    lines.push('  ... and more (see full routine)');
  } else if (plan.stretching.routine === 'targeted') {
    const routine = getTargetedStretches(plan.stretching.focus_areas);
    routine.exercises.slice(0, 4).forEach(ex => {
      lines.push(`  □ ${ex.name} (${ex.duration})`);
    });
  } else {
    lines.push('  □ Basic post-run stretches (10-15 min)');
  }

  lines.push('');

  if (plan.optional_activity) {
    lines.push('OPTIONAL ACTIVITY');
    lines.push(`  ${plan.optional_activity.duration_min} min ${plan.optional_activity.type}`);
    lines.push(`  Intensity: ${plan.optional_activity.intensity}`);
    lines.push('');
  }

  lines.push('NUTRITION');
  lines.push(`  ${plan.nutrition_notes}`);

  if (plan.tomorrow_preview) {
    lines.push('');
    lines.push('TOMORROW');
    lines.push(`  ${plan.tomorrow_preview}`);
  }

  return lines.join('\n');
}

/**
 * Format a stretching routine for display
 */
export function formatStretchingRoutine(routine: StretchingRoutine): string {
  const lines: string[] = [];

  lines.push(routine.name.toUpperCase());
  lines.push(`Duration: ${routine.duration_min} min`);
  lines.push('');

  routine.exercises.forEach(ex => {
    const notesStr = ex.notes ? ` - ${ex.notes}` : '';
    lines.push(`□ ${ex.name} (${ex.duration})${notesStr}`);
  });

  return lines.join('\n');
}

// ===== Utility Functions =====

function formatRestDayType(type: RestDayType): string {
  switch (type) {
    case 'full_rest': return 'Full Rest';
    case 'active_recovery': return 'Active Recovery';
    case 'cross_train': return 'Cross-Training';
    default: return type;
  }
}

function capitalizeFirst(str: string): string {
  return str.charAt(0).toUpperCase() + str.slice(1);
}
