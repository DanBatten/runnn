/**
 * Nutrition Guidelines - Workout and race nutrition recommendations
 *
 * Provides:
 * - Pre-run fueling guidelines
 * - During-run fueling (gels, hydration)
 * - Recovery nutrition
 * - Race-day nutrition plans
 */

// ===== Types =====

export interface WorkoutNutrition {
  pre_run: {
    timing: string;
    calories: number;
    description: string;
    examples: string[];
  };
  during_run: {
    needed: boolean;
    carbs_per_hour: number;
    timing: string | null;
    hydration: string;
    electrolytes: boolean;
  };
  post_run: {
    priority: 'high' | 'moderate' | 'low';
    protein_g: number;
    carbs_g: number;
    window: string;
    examples: string[];
  };
}

export interface HydrationGuidelines {
  pre_run_oz: number;
  during_oz_per_15min: number;
  post_run_oz: number;
  electrolytes_needed: boolean;
  notes: string;
}

export interface RaceDayNutrition {
  night_before: string[];
  morning_of: {
    timing: string;
    calories: number;
    examples: string[];
  };
  pre_race: {
    timing: string;
    description: string;
  };
  during_race: {
    strategy: string;
    gel_timing: string[];
    hydration: string;
  };
  post_race: string[];
}

// ===== Functions =====

/**
 * Get nutrition guidelines for a workout based on type and duration
 */
export function getWorkoutNutrition(
  workoutType: string,
  durationMinutes: number,
  distanceMiles: number,
  conditionsHot: boolean = false
): WorkoutNutrition {
  // Pre-run fueling based on duration
  const preRun = getPreRunFueling(durationMinutes);

  // During-run fueling
  const duringRun = getDuringRunFueling(durationMinutes, workoutType, conditionsHot);

  // Post-run recovery
  const postRun = getPostRunRecovery(workoutType, durationMinutes, distanceMiles);

  return { pre_run: preRun, during_run: duringRun, post_run: postRun };
}

/**
 * Get pre-run fueling guidelines
 */
function getPreRunFueling(durationMinutes: number): WorkoutNutrition['pre_run'] {
  if (durationMinutes < 45) {
    return {
      timing: 'Optional',
      calories: 0,
      description: 'Water only is fine, small snack if hungry',
      examples: ['Nothing needed', 'Few sips of water', 'Small banana if hungry'],
    };
  }

  if (durationMinutes < 75) {
    return {
      timing: '1-2 hours before',
      calories: 150,
      description: 'Light carb-focused snack',
      examples: ['Banana', 'Toast with honey', 'Small bowl of oatmeal', 'Applesauce'],
    };
  }

  if (durationMinutes < 90) {
    return {
      timing: '2-3 hours before',
      calories: 300,
      description: 'Moderate carb-focused meal',
      examples: [
        'Oatmeal with banana',
        'Toast with peanut butter',
        'Bagel with jam',
        'Rice with honey',
      ],
    };
  }

  return {
    timing: '3-4 hours before',
    calories: 500,
    description: 'Full pre-run meal with familiar foods',
    examples: [
      'Oatmeal with banana and honey',
      'Bagel with peanut butter and banana',
      'Rice, eggs, and toast',
      'Pancakes with syrup',
    ],
  };
}

/**
 * Get during-run fueling guidelines
 */
function getDuringRunFueling(
  durationMinutes: number,
  workoutType: string,
  conditionsHot: boolean
): WorkoutNutrition['during_run'] {
  const isHighIntensity = ['tempo', 'threshold', 'interval', 'race'].includes(workoutType);

  if (durationMinutes < 60) {
    return {
      needed: false,
      carbs_per_hour: 0,
      timing: null,
      hydration: conditionsHot
        ? '4-6 oz every 15-20 min if available'
        : 'Water only if needed',
      electrolytes: conditionsHot,
    };
  }

  if (durationMinutes < 90) {
    return {
      needed: isHighIntensity || conditionsHot,
      carbs_per_hour: isHighIntensity ? 30 : 0,
      timing: isHighIntensity ? 'Optional gel at 45 min if intensity is high' : null,
      hydration: conditionsHot
        ? '6-8 oz every 15 min'
        : '4-6 oz every 20 min',
      electrolytes: conditionsHot || durationMinutes > 75,
    };
  }

  if (durationMinutes < 120) {
    return {
      needed: true,
      carbs_per_hour: 30,
      timing: 'Gel every 35-40 min starting at 30-40 min',
      hydration: conditionsHot
        ? '8-10 oz every 15 min with electrolytes'
        : '6-8 oz every 15-20 min',
      electrolytes: true,
    };
  }

  // > 2 hours
  return {
    needed: true,
    carbs_per_hour: 45,
    timing: 'Gel every 25-30 min starting at 30 min',
    hydration: conditionsHot
      ? '10-12 oz every 15 min with electrolytes'
      : '8 oz every 15-20 min with electrolytes',
    electrolytes: true,
  };
}

/**
 * Get post-run recovery guidelines
 */
function getPostRunRecovery(
  workoutType: string,
  durationMinutes: number,
  distanceMiles: number
): WorkoutNutrition['post_run'] {
  const isHardWorkout = ['tempo', 'threshold', 'interval', 'long', 'race'].includes(workoutType);
  const isLongRun = distanceMiles >= 10 || durationMinutes >= 90;

  if (!isHardWorkout && durationMinutes < 45) {
    return {
      priority: 'low',
      protein_g: 15,
      carbs_g: 30,
      window: 'Within 2 hours',
      examples: ['Normal meal is fine', 'Glass of milk', 'Small snack'],
    };
  }

  if (isLongRun || (isHardWorkout && durationMinutes >= 60)) {
    return {
      priority: 'high',
      protein_g: 25,
      carbs_g: 50,
      window: 'Within 30 minutes',
      examples: [
        'Recovery shake (whey protein + banana)',
        'Chocolate milk (16 oz)',
        'Greek yogurt with granola',
        'Protein smoothie with fruit',
      ],
    };
  }

  return {
    priority: 'moderate',
    protein_g: 20,
    carbs_g: 40,
    window: 'Within 1 hour',
    examples: [
      'Protein shake',
      'Chocolate milk',
      'Eggs and toast',
      'Greek yogurt with fruit',
    ],
  };
}

/**
 * Get hydration guidelines based on conditions
 */
export function getHydrationGuidelines(
  durationMinutes: number,
  temperatureF: number = 65
): HydrationGuidelines {
  const isCool = temperatureF < 60;
  const isHot = temperatureF >= 75;

  if (isCool) {
    return {
      pre_run_oz: durationMinutes < 60 ? 8 : 12,
      during_oz_per_15min: durationMinutes > 45 ? 4 : 0,
      post_run_oz: 16,
      electrolytes_needed: durationMinutes > 90,
      notes: 'Cool conditions - hydration needs are lower but don\'t skip entirely',
    };
  }

  if (isHot) {
    return {
      pre_run_oz: 16,
      during_oz_per_15min: 8,
      post_run_oz: 32,
      electrolytes_needed: durationMinutes > 45,
      notes: 'Hot conditions - prioritize hydration, add electrolytes, slow pace 15-20 sec/mi',
    };
  }

  // Moderate conditions
  return {
    pre_run_oz: 12,
    during_oz_per_15min: 6,
    post_run_oz: 24,
    electrolytes_needed: durationMinutes > 60,
    notes: 'Moderate conditions - standard hydration protocol',
  };
}

/**
 * Get race day nutrition plan based on race distance
 */
export function getRaceDayNutrition(distanceMeters: number): RaceDayNutrition {
  const distanceMiles = distanceMeters / 1609.344;

  // 5K
  if (distanceMiles <= 5) {
    return {
      night_before: [
        'Normal dinner with carbs',
        'Stay hydrated',
        'Avoid trying new foods',
      ],
      morning_of: {
        timing: '2-3 hours before start',
        calories: 200,
        examples: ['Light toast and banana', 'Small oatmeal', 'Familiar breakfast'],
      },
      pre_race: {
        timing: '30 min before',
        description: '4-6 oz water, optional small energy chew',
      },
      during_race: {
        strategy: 'No fueling needed - just water if available',
        gel_timing: [],
        hydration: 'Sip water at aid stations if very hot',
      },
      post_race: [
        'Hydrate immediately',
        'Recovery snack within 30 min',
        'Full meal within 2 hours',
      ],
    };
  }

  // 10K
  if (distanceMiles <= 8) {
    return {
      night_before: [
        'Carb-focused dinner',
        'Stay well hydrated',
        'Avoid high fiber and spicy foods',
      ],
      morning_of: {
        timing: '2-3 hours before start',
        calories: 300,
        examples: ['Toast with PB and banana', 'Oatmeal with honey', 'Bagel with jam'],
      },
      pre_race: {
        timing: '15-30 min before',
        description: '6-8 oz water or sports drink',
      },
      during_race: {
        strategy: 'Optional - most can complete without fueling',
        gel_timing: ['Optional gel at mile 4 if racing hard'],
        hydration: 'Water or sports drink at aid stations',
      },
      post_race: [
        'Hydrate with water and electrolytes',
        'Recovery shake or chocolate milk within 30 min',
        'Balanced meal within 2 hours',
      ],
    };
  }

  // Half Marathon
  if (distanceMiles <= 15) {
    return {
      night_before: [
        'Carb-focused dinner (pasta, rice, potatoes)',
        'Extra water throughout the day',
        'Avoid alcohol and heavy fiber',
        'Familiar foods only',
      ],
      morning_of: {
        timing: '3-4 hours before start',
        calories: 400,
        examples: [
          'Oatmeal with banana and honey',
          'Bagel with PB and banana',
          'Toast, eggs, and fruit',
        ],
      },
      pre_race: {
        timing: '30-45 min before',
        description: '8 oz water or sports drink, optional energy gel',
      },
      during_race: {
        strategy: 'Gel every 45 min or so, aim for 30-45g carbs/hour',
        gel_timing: ['Mile 5', 'Mile 9', 'Optional mile 11-12'],
        hydration: 'Water or sports drink at every aid station (4-6 oz)',
      },
      post_race: [
        'Immediate: water + electrolytes',
        'Within 30 min: recovery drink with protein and carbs',
        'Within 2 hours: full meal with protein, carbs, and sodium',
        'Continue hydrating throughout the day',
      ],
    };
  }

  // Marathon
  return {
    night_before: [
      'Large carb-focused dinner (500-700 cal carbs)',
      'Extra sodium with meal',
      'Hydrate well but don\'t overdo it',
      'Familiar foods only - nothing new',
      'Early bedtime',
    ],
    morning_of: {
      timing: '3-4 hours before start',
      calories: 600,
      examples: [
        'Oatmeal with banana, honey, and peanut butter',
        'Bagel with PB, banana, and sports drink',
        'White rice with honey and banana',
      ],
    },
    pre_race: {
      timing: '30-45 min before',
      description: '8-12 oz sports drink, gel 15 min before start',
    },
    during_race: {
      strategy: 'Start fueling early, gel every 4-5 miles, aim for 45-60g carbs/hour',
      gel_timing: ['Mile 4-5', 'Mile 9-10', 'Mile 14-15', 'Mile 18-19', 'Mile 22-23'],
      hydration: 'Sports drink at every other aid station, water at the rest (6-8 oz each)',
    },
    post_race: [
      'Immediate: water, sports drink, banana',
      'Within 30 min: recovery shake or chocolate milk',
      'Within 1-2 hours: salty carb-rich meal (pizza, burger, etc.)',
      'Continue hydrating for 24+ hours',
      'Anti-inflammatory foods: berries, tart cherry juice',
    ],
  };
}

/**
 * Generate nutrition guidance text for a workout prescription
 */
export function formatNutritionGuidance(nutrition: WorkoutNutrition): string {
  const lines: string[] = [];

  // Pre-run
  lines.push('NUTRITION');
  lines.push(`  Pre:  ${nutrition.pre_run.description} (${nutrition.pre_run.timing})`);
  if (nutrition.pre_run.examples.length > 0 && nutrition.pre_run.calories > 0) {
    lines.push(`        Examples: ${nutrition.pre_run.examples.slice(0, 2).join(', ')}`);
  }

  // During
  if (nutrition.during_run.needed && nutrition.during_run.timing) {
    lines.push(`  During: ${nutrition.during_run.timing}`);
  }
  lines.push(`        Hydration: ${nutrition.during_run.hydration}`);
  if (nutrition.during_run.electrolytes) {
    lines.push('        Add electrolytes');
  }

  // Post
  lines.push(`  Post: ${nutrition.post_run.examples[0]} (${nutrition.post_run.window})`);
  lines.push(`        Target: ${nutrition.post_run.protein_g}g protein, ${nutrition.post_run.carbs_g}g carbs`);

  return lines.join('\n');
}

/**
 * Get fueling practice progression for long runs
 */
export function getLongRunFuelingProgression(weekNumber: number, totalWeeks: number): string {
  const phase = Math.ceil((weekNumber / totalWeeks) * 3);

  switch (phase) {
    case 1:
      return 'Introduce fueling on runs > 75 min. Try one gel mid-run to test tolerance.';
    case 2:
      return 'Dial in timing and products. Target 30-45g carbs/hour. Note what works for you.';
    case 3:
      return 'Practice race-day exact strategy. Use the same products and timing you\'ll use on race day.';
    default:
      return 'Focus on consistent fueling. Your body adapts to what you practice.';
  }
}
