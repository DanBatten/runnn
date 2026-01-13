#!/usr/bin/env tsx
/**
 * Create a peak/race-specific plan for LA Marathon
 * This continues from the user's current training state rather than starting fresh
 */

import { config } from 'dotenv';
config();

import { initializeDb, query, execute, closeDb, generateId } from '../src/db/client.js';
import { emitEvent } from '../src/db/events.js';

const dbPath = process.env.DATABASE_PATH ?? './data/coach.db';
initializeDb(dbPath);

// Based on analysis of actual training data
const CURRENT_FITNESS = {
  weeklyMileage: 35,        // Current average
  peakLongRun: 16,          // Longest recent run
  marathonPace: 6.5,        // 6:30/mi in decimal minutes
  easyPace: 8.0,            // ~8:00/mi
  tempoPace: 6.75,          // ~6:45/mi
  intervalPace: 6.1,        // ~6:06/mi
  thresholdPace: 6.2,       // ~6:12/mi
};

const RACE = {
  name: 'LA Marathon',
  date: '2026-03-08',
  distance: 'marathon',
  distanceMeters: 42195,
  goalTime: '2:55:00',
  goalSeconds: 2 * 3600 + 55 * 60, // 10500 seconds
  goalPace: 6.69, // 6:41/mi
};

function formatPace(decimalMinutes: number): string {
  const mins = Math.floor(decimalMinutes);
  const secs = Math.round((decimalMinutes - mins) * 60);
  return `${mins}:${secs.toString().padStart(2, '0')}/mi`;
}

interface WeekPlan {
  weekNumber: number;
  startDate: string;
  blockType: 'build' | 'peak' | 'taper';
  targetMiles: number;
  isRecovery: boolean;
  workouts: WorkoutPlan[];
  keySession: string;
  notes: string;
}

interface WorkoutPlan {
  dayOffset: number; // 0 = Monday
  type: string;
  distanceMiles: number;
  description: string;
  paceGuidance: string;
}

function generateWeeklyPlans(): WeekPlan[] {
  const weeks: WeekPlan[] = [];
  const raceDate = new Date(RACE.date);

  // 8 weeks to race
  // Week 1-2: Build (40-45 mi) - continue momentum
  // Week 3-4: Peak (48-52 mi) - highest volume, longest runs
  // Week 5-6: Race-specific (45-48 mi) - quality over quantity
  // Week 7: Pre-taper (38 mi)
  // Week 8: Race week taper (25 mi)

  const weekConfigs = [
    { miles: 42, block: 'build' as const, longRun: 17, keySession: '8 mi with 5 @ MP', recovery: false },
    { miles: 45, block: 'build' as const, longRun: 18, keySession: '10 mi with 6 @ MP', recovery: false },
    { miles: 50, block: 'peak' as const, longRun: 20, keySession: '12 mi with 8 @ MP', recovery: false },
    { miles: 35, block: 'peak' as const, longRun: 12, keySession: 'Recovery week - easy running', recovery: true },
    { miles: 48, block: 'peak' as const, longRun: 18, keySession: '2x4 mi @ MP with 800m jog', recovery: false },
    { miles: 45, block: 'taper' as const, longRun: 14, keySession: '10 mi with 4 @ MP', recovery: false },
    { miles: 35, block: 'taper' as const, longRun: 10, keySession: '6 mi with 3 @ MP', recovery: false },
    { miles: 25, block: 'taper' as const, longRun: 26.2, keySession: 'RACE DAY - LA Marathon', recovery: false },
  ];

  for (let i = 0; i < 8; i++) {
    const config = weekConfigs[i];
    // Race is on Sunday March 8. Week 8 starts Monday March 2.
    // Work backwards: each week starts 7 days earlier
    const weekStart = new Date(raceDate);
    weekStart.setDate(raceDate.getDate() - 6 - (7 - i) * 7); // -6 to get to Monday of race week

    const startDate = weekStart.toISOString().slice(0, 10);

    const workouts = generateWorkoutsForWeek(config, i + 1);

    weeks.push({
      weekNumber: i + 1,
      startDate,
      blockType: config.block,
      targetMiles: config.miles,
      isRecovery: config.recovery,
      workouts,
      keySession: config.keySession,
      notes: getWeekNotes(i + 1, config),
    });
  }

  return weeks;
}

function generateWorkoutsForWeek(config: typeof weekConfigs[0], weekNum: number): WorkoutPlan[] {
  const workouts: WorkoutPlan[] = [];
  const { miles, longRun, recovery } = config;

  if (weekNum === 8) {
    // Race week
    workouts.push({ dayOffset: 0, type: 'easy', distanceMiles: 4, description: 'Easy shakeout', paceGuidance: formatPace(8.0) });
    workouts.push({ dayOffset: 1, type: 'easy', distanceMiles: 3, description: 'Easy + 4x100m strides', paceGuidance: formatPace(8.0) });
    workouts.push({ dayOffset: 2, type: 'rest', distanceMiles: 0, description: 'Rest day', paceGuidance: '-' });
    workouts.push({ dayOffset: 3, type: 'easy', distanceMiles: 3, description: 'Easy shakeout', paceGuidance: formatPace(8.0) });
    workouts.push({ dayOffset: 4, type: 'easy', distanceMiles: 2, description: '2 mi easy + strides', paceGuidance: formatPace(8.0) });
    workouts.push({ dayOffset: 5, type: 'rest', distanceMiles: 0, description: 'Rest - race tomorrow', paceGuidance: '-' });
    workouts.push({ dayOffset: 6, type: 'race', distanceMiles: 26.2, description: 'LA Marathon - RACE DAY', paceGuidance: formatPace(6.69) });
    return workouts;
  }

  if (recovery) {
    // Recovery week - all easy
    workouts.push({ dayOffset: 0, type: 'easy', distanceMiles: 5, description: 'Easy run', paceGuidance: formatPace(8.0) });
    workouts.push({ dayOffset: 1, type: 'rest', distanceMiles: 0, description: 'Rest or cross-train', paceGuidance: '-' });
    workouts.push({ dayOffset: 2, type: 'easy', distanceMiles: 6, description: 'Easy run', paceGuidance: formatPace(8.0) });
    workouts.push({ dayOffset: 3, type: 'easy', distanceMiles: 5, description: 'Easy + strides', paceGuidance: formatPace(8.0) });
    workouts.push({ dayOffset: 4, type: 'rest', distanceMiles: 0, description: 'Rest', paceGuidance: '-' });
    workouts.push({ dayOffset: 5, type: 'easy', distanceMiles: 5, description: 'Easy run', paceGuidance: formatPace(8.0) });
    workouts.push({ dayOffset: 6, type: 'long', distanceMiles: longRun, description: `${longRun} mi easy long run`, paceGuidance: formatPace(8.0) });
    return workouts;
  }

  // Standard training week (5 days)
  const easyMiles = miles - longRun;
  const midweekQuality = weekNum <= 4 ? Math.min(8, miles * 0.15) : Math.min(10, miles * 0.18);
  const remainingEasy = easyMiles - midweekQuality;

  // Monday - Quality session (tempo/MP work)
  if (weekNum <= 2) {
    workouts.push({
      dayOffset: 0,
      type: 'tempo',
      distanceMiles: Math.round(midweekQuality),
      description: `${Math.round(midweekQuality)} mi with ${Math.round(midweekQuality - 2)} @ tempo`,
      paceGuidance: formatPace(6.5)
    });
  } else if (weekNum <= 5) {
    const mpMiles = Math.round(midweekQuality * 0.6);
    workouts.push({
      dayOffset: 0,
      type: 'tempo',
      distanceMiles: Math.round(midweekQuality),
      description: `${Math.round(midweekQuality)} mi with ${mpMiles} @ marathon pace`,
      paceGuidance: formatPace(6.5)
    });
  } else {
    workouts.push({
      dayOffset: 0,
      type: 'tempo',
      distanceMiles: 6,
      description: `6 mi with 3 @ marathon pace`,
      paceGuidance: formatPace(6.5)
    });
  }

  // Tuesday - Rest
  workouts.push({ dayOffset: 1, type: 'rest', distanceMiles: 0, description: 'Rest or cross-train', paceGuidance: '-' });

  // Wednesday - Easy
  const wedMiles = Math.round(remainingEasy * 0.35);
  workouts.push({ dayOffset: 2, type: 'easy', distanceMiles: wedMiles, description: `${wedMiles} mi easy`, paceGuidance: formatPace(8.0) });

  // Thursday - Midweek medium/intervals
  const thuMiles = Math.round(remainingEasy * 0.35);
  if (weekNum % 2 === 0 && !recovery) {
    workouts.push({
      dayOffset: 3,
      type: 'interval',
      distanceMiles: thuMiles,
      description: `${thuMiles} mi with 6x800m @ 5K pace`,
      paceGuidance: formatPace(6.1)
    });
  } else {
    workouts.push({
      dayOffset: 3,
      type: 'easy',
      distanceMiles: thuMiles,
      description: `${thuMiles} mi easy + strides`,
      paceGuidance: formatPace(8.0)
    });
  }

  // Friday - Easy
  const friMiles = Math.round(remainingEasy * 0.3);
  workouts.push({ dayOffset: 4, type: 'easy', distanceMiles: friMiles, description: `${friMiles} mi easy`, paceGuidance: formatPace(8.0) });

  // Saturday - Rest before Sunday long run
  workouts.push({ dayOffset: 5, type: 'rest', distanceMiles: 0, description: 'Rest before long run', paceGuidance: '-' });

  // Sunday - Long run (user's preferred long run day)
  let longRunDesc: string;
  if (weekNum === 3) {
    longRunDesc = `${longRun} mi: 12 easy + 8 @ marathon pace`;
  } else if (weekNum === 5) {
    longRunDesc = `${longRun} mi: 10 easy + 6 @ MP + 2 easy`;
  } else if (longRun >= 16) {
    const mpMiles = Math.round(longRun * 0.3);
    longRunDesc = `${longRun} mi: ${longRun - mpMiles - 2} easy + ${mpMiles} @ MP + 2 easy`;
  } else {
    longRunDesc = `${longRun} mi easy long run`;
  }

  workouts.push({
    dayOffset: 6,
    type: 'long',
    distanceMiles: longRun,
    description: longRunDesc,
    paceGuidance: formatPace(7.5)
  });

  return workouts;
}

function getWeekNotes(weekNum: number, config: typeof weekConfigs[0]): string {
  if (weekNum === 1) return 'Continue momentum from base. First MP long run segment.';
  if (weekNum === 2) return 'Building toward peak. 18-miler with substantial MP work.';
  if (weekNum === 3) return 'PEAK WEEK - Highest mileage. 20-miler is your dress rehearsal.';
  if (weekNum === 4) return 'Recovery week. Trust the taper - easy running only.';
  if (weekNum === 5) return 'Race-specific work. Quality over quantity now.';
  if (weekNum === 6) return 'Taper begins. Maintain intensity, reduce volume.';
  if (weekNum === 7) return 'Pre-race week. Stay sharp, stay fresh.';
  if (weekNum === 8) return 'RACE WEEK! Trust your training. Execute the plan.';
  return '';
}

async function createPlan() {
  console.log('🏃 Creating LA Marathon Peak Plan\n');
  console.log('Based on your current fitness:');
  console.log(`  • Weekly mileage: ~${CURRENT_FITNESS.weeklyMileage} mi`);
  console.log(`  • Peak long run: ${CURRENT_FITNESS.peakLongRun} mi`);
  console.log(`  • Marathon pace work: ${formatPace(CURRENT_FITNESS.marathonPace)}`);
  console.log(`  • Interval pace: ${formatPace(CURRENT_FITNESS.intervalPace)}`);
  console.log('');

  // Archive existing plan
  const existingPlan = query<{ id: string; name: string }>(
    "SELECT id, name FROM training_plans WHERE status = 'active' LIMIT 1"
  );

  if (existingPlan.length > 0) {
    console.log(`Archiving previous plan: "${existingPlan[0].name}"`);
    execute('UPDATE training_plans SET status = ? WHERE id = ?', ['archived', existingPlan[0].id]);
  }

  // Generate weeks
  const weeks = generateWeeklyPlans();

  // Create plan record
  const planId = generateId();
  const planStartDate = weeks[0].startDate;
  const planEndDate = RACE.date;

  const philosophy = `This 8-week plan continues from your established base of ${CURRENT_FITNESS.weeklyMileage} mi/week. ` +
    `You've already built to ${CURRENT_FITNESS.peakLongRun}-mile long runs with marathon pace work. ` +
    `Now we shift to race-specific preparation: peak at 50 mi/week with a 20-miler, ` +
    `then taper smartly to arrive at the start line fresh and ready for ${RACE.goalTime}.`;

  execute(`
    INSERT INTO training_plans (
      id, name, status, start_local_date, end_local_date,
      primary_goal, goal_time_seconds, notes, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))
  `, [
    planId,
    'LA Marathon - Peak Phase',
    'active',
    planStartDate,
    planEndDate,
    `${RACE.name} - ${RACE.goalTime}`,
    RACE.goalSeconds,
    philosophy,
  ]);

  // Create blocks
  const blocks = [
    { type: 'build', name: 'Build Phase', startWeek: 1, endWeek: 2, focus: 'Continue momentum, introduce longer MP segments' },
    { type: 'peak', name: 'Peak Phase', startWeek: 3, endWeek: 5, focus: 'Highest volume, race-specific long runs, recovery week' },
    { type: 'taper', name: 'Taper Phase', startWeek: 6, endWeek: 8, focus: 'Reduce volume, maintain intensity, race execution' },
  ];

  const blockIds: Record<string, string> = {};
  for (const block of blocks) {
    const blockId = generateId();
    blockIds[block.type] = blockId;
    const blockWeeks = weeks.filter(w => w.weekNumber >= block.startWeek && w.weekNumber <= block.endWeek);
    const totalMiles = blockWeeks.reduce((sum, w) => sum + w.targetMiles, 0) / blockWeeks.length;

    execute(`
      INSERT INTO training_blocks (
        id, training_plan_id, name, block_type,
        start_local_date, end_local_date, focus, weekly_target_miles, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
    `, [
      blockId,
      planId,
      block.name,
      block.type,
      blockWeeks[0].startDate,
      blockWeeks[blockWeeks.length - 1].startDate,
      block.focus,
      Math.round(totalMiles),
    ]);
  }

  // Create planned workouts
  let totalWorkouts = 0;
  for (const week of weeks) {
    const blockId = blockIds[week.blockType];

    for (const workout of week.workouts) {
      if (workout.type === 'rest') continue;

      const workoutDate = new Date(week.startDate);
      workoutDate.setDate(workoutDate.getDate() + workout.dayOffset);
      const dateStr = workoutDate.toISOString().slice(0, 10);

      const workoutId = generateId();
      execute(`
        INSERT INTO planned_workouts (
          id, training_plan_id, training_block_id, local_date, type, priority,
          target_distance_meters, prescription, rationale, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
      `, [
        workoutId,
        planId,
        blockId,
        dateStr,
        workout.type,
        workout.type === 'long' || workout.type === 'tempo' || workout.type === 'race' ? 'A' : 'B',
        Math.round(workout.distanceMiles * 1609.344),
        `${workout.description} @ ${workout.paceGuidance}`,
        `Week ${week.weekNumber}: ${week.notes}`,
      ]);
      totalWorkouts++;
    }
  }

  // Display plan
  console.log('═'.repeat(70));
  console.log('                    LA MARATHON - PEAK PHASE PLAN');
  console.log('═'.repeat(70));
  console.log('');
  console.log(`  Race: ${RACE.name} - ${RACE.date}`);
  console.log(`  Goal: ${RACE.goalTime} (${formatPace(RACE.goalPace)} pace)`);
  console.log(`  Peak Mileage: 50 mi/week`);
  console.log(`  Philosophy: Continue from your ${CURRENT_FITNESS.weeklyMileage} mi/week base,`);
  console.log(`              peak at 50 mi with 20-miler, taper to race.`);
  console.log('');
  console.log('─'.repeat(70));
  console.log('');

  console.log('  Weekly Overview:');
  console.log('  ┌──────┬────────┬───────┬─────────────────────────────────┬──────────┐');
  console.log('  │ Week │ Phase  │ Miles │ Key Session                     │ Long Run │');
  console.log('  ├──────┼────────┼───────┼─────────────────────────────────┼──────────┤');

  for (const week of weeks) {
    const phase = week.blockType.toUpperCase().padEnd(6);
    const miles = week.targetMiles.toString().padStart(5);
    const longRun = week.workouts.find(w => w.type === 'long' || w.type === 'race');
    const longRunStr = longRun ?
      (longRun.type === 'race' ? 'RACE DAY!' : `${longRun.distanceMiles}mi`) :
      '-';
    const keySession = week.keySession.substring(0, 31).padEnd(31);

    console.log(`  │  ${week.weekNumber}   │ ${phase} │${miles} │ ${keySession} │ ${longRunStr.padEnd(8)} │`);
  }

  console.log('  └──────┴────────┴───────┴─────────────────────────────────┴──────────┘');
  console.log('');

  // Mileage chart
  console.log('  Mileage Progression:');
  const maxMiles = Math.max(...weeks.map(w => w.targetMiles));
  for (const week of weeks) {
    const barWidth = Math.round((week.targetMiles / maxMiles) * 35);
    const bar = '█'.repeat(barWidth) + '░'.repeat(35 - barWidth);
    const label = week.targetMiles.toString().padStart(3);
    const marker = week.weekNumber === 3 ? ' ← PEAK' : (week.weekNumber === 8 ? ' ← RACE' : '');
    console.log(`   ${label} mi │${bar}│${marker}`);
  }
  console.log('');

  console.log('  Key Long Runs:');
  console.log('    Week 2: 18 mi with 6 @ marathon pace');
  console.log('    Week 3: 20 mi with 8 @ marathon pace (DRESS REHEARSAL)');
  console.log('    Week 5: 18 mi with 6 @ marathon pace');
  console.log('    Week 8: 26.2 mi @ race pace (LA MARATHON!)');
  console.log('');

  console.log(`✅ Plan saved! (${totalWorkouts} workouts created)`);
  console.log('');
  console.log('  Next steps:');
  console.log('    • View this week: runnn plan week');
  console.log('    • Morning check:  runnn morning');
  console.log('    • After runs:     runnn postrun');
}

createPlan()
  .then(() => {
    closeDb();
    process.exit(0);
  })
  .catch((err) => {
    console.error('Error:', err);
    closeDb();
    process.exit(1);
  });
