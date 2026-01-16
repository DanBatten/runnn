/**
 * Postrun command - Process latest run and notes
 *
 * Flow:
 * 1. Sync latest Garmin activity
 * 2. Process pending voice notes
 * 3. Match + link notes to workout
 * 4. Compare planned vs actual
 * 5. Generate coach analysis
 */

import chalk from 'chalk';
import { isDbInitialized, query, queryOne, closeDb, getDb } from '../db/client.js';
import { syncGarmin } from '../connectors/garmin.js';
import { processRunNotes } from '../connectors/run-notes.js';
import { getTimezone } from '../util/timezone.js';

interface Workout {
  id: string;
  local_date: string;
  type: string;
  distance_meters: number | null;
  duration_seconds: number | null;
  avg_pace_sec_per_mile: number | null;
  avg_hr: number | null;
  max_hr: number | null;
  perceived_exertion: number | null;
  mood: string | null;
  personal_notes: string | null;
  discomfort_notes: string | null;
  discomfort_locations: string | null;
}

interface PlannedWorkout {
  id: string;
  local_date: string;
  type: string;
  priority: string;
  target_distance_meters: number | null;
  prescription: string | null;
  rationale: string | null;
}

function formatPace(secPerMile: number): string {
  const mins = Math.floor(secPerMile / 60);
  const secs = Math.round(secPerMile % 60);
  return `${mins}:${secs.toString().padStart(2, '0')}/mi`;
}

function formatDuration(seconds: number): string {
  const hrs = Math.floor(seconds / 3600);
  const mins = Math.floor((seconds % 3600) / 60);
  const secs = Math.round(seconds % 60);

  if (hrs > 0) {
    return `${hrs}:${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  }
  return `${mins}:${secs.toString().padStart(2, '0')}`;
}

function calculateExecutionScore(planned: PlannedWorkout, actual: Workout): { score: number; notes: string[] } {
  const notes: string[] = [];
  let score = 100;

  if (!planned.target_distance_meters || !actual.distance_meters) {
    return { score: 80, notes: ['Unable to compare distance'] };
  }

  const plannedMiles = planned.target_distance_meters / 1609.344;
  const actualMiles = actual.distance_meters / 1609.344;
  const distanceDiff = ((actualMiles - plannedMiles) / plannedMiles) * 100;

  if (Math.abs(distanceDiff) <= 5) {
    notes.push(`Distance: ${actualMiles.toFixed(1)}mi vs ${plannedMiles.toFixed(1)}mi planned ✓`);
  } else if (distanceDiff > 5) {
    score -= 5;
    notes.push(`Distance: ${actualMiles.toFixed(1)}mi (${distanceDiff.toFixed(0)}% over planned)`);
  } else {
    score -= 10;
    notes.push(`Distance: ${actualMiles.toFixed(1)}mi (${Math.abs(distanceDiff).toFixed(0)}% under planned)`);
  }

  // RPE assessment
  if (actual.perceived_exertion) {
    const expectedRPE = planned.type === 'easy' ? 4 :
                        planned.type === 'tempo' ? 7 :
                        planned.type === 'interval' ? 8 :
                        planned.type === 'long' ? 5 : 6;

    const rpeDiff = actual.perceived_exertion - expectedRPE;
    if (Math.abs(rpeDiff) <= 1) {
      notes.push(`RPE ${actual.perceived_exertion}/10 - appropriate for ${planned.type} run ✓`);
    } else if (rpeDiff > 1) {
      score -= 5;
      notes.push(`RPE ${actual.perceived_exertion}/10 - harder than expected for ${planned.type}`);
    } else {
      notes.push(`RPE ${actual.perceived_exertion}/10 - felt easier than expected`);
    }
  }

  // Discomfort penalty
  if (actual.discomfort_locations) {
    score -= 5;
    try {
      const locations = JSON.parse(actual.discomfort_locations);
      notes.push(`Discomfort noted: ${locations.join(', ')}`);
    } catch {
      notes.push('Some discomfort noted');
    }
  }

  return { score: Math.max(0, Math.min(100, score)), notes };
}

function generateCoachAnalysis(
  planned: PlannedWorkout | null,
  actual: Workout,
  _executionScore: number,
  weekMiles: number,
  weekRunCount: number,
  nextWorkout: PlannedWorkout | null
): string[] {
  const analysis: string[] = [];

  const actualMiles = (actual.distance_meters || 0) / 1609.344;
  const plannedMiles = planned ? (planned.target_distance_meters || 0) / 1609.344 : 0;

  // Specific feedback based on what happened
  if (planned) {
    const distanceDiff = actualMiles - plannedMiles;
    const pctDiff = plannedMiles > 0 ? (distanceDiff / plannedMiles) * 100 : 0;

    if (pctDiff > 10) {
      analysis.push(`You ran ${distanceDiff.toFixed(1)} miles more than planned. That's fine occasionally, but be mindful of cumulative fatigue.`);
    } else if (pctDiff < -15) {
      analysis.push(`Shorter than planned - if you cut it short due to how you felt, that's smart listening to your body.`);
    } else {
      analysis.push(`Good execution on the ${planned.type} run - right on target.`);
    }
  }

  // Notes-based feedback
  if (actual.personal_notes) {
    const notes = actual.personal_notes.toLowerCase();

    if (notes.includes('stiff') || notes.includes('tight') || notes.includes('sore')) {
      analysis.push('You mentioned stiffness - make sure to do your mobility work tonight. Consider an extra easy day if it persists.');
    }

    if (notes.includes('warmed up') || notes.includes('loosened')) {
      analysis.push('Good that you warmed into it. That\'s typical 2-3 days after a long run.');
    }

    if (notes.includes('ramped') || notes.includes('picked up') || notes.includes('negative split')) {
      analysis.push('Nice work on the progressive effort - that builds confidence and fitness.');
    }
  }

  // Mood feedback
  if (actual.mood === 'tired' || actual.mood === 'rough') {
    analysis.push('Recovery is the priority tonight - sleep, hydration, and easy movement tomorrow.');
  }

  // Discomfort advice
  if (actual.discomfort_notes) {
    analysis.push(`Monitor the ${actual.discomfort_notes.toLowerCase()}. Ice and gentle stretching if needed.`);
  }

  // Weekly context
  if (weekMiles > 0) {
    analysis.push(`This week: ${weekMiles.toFixed(1)} miles across ${weekRunCount} runs.`);
  }

  // Tomorrow preview
  if (nextWorkout) {
    const nextMiles = (nextWorkout.target_distance_meters || 0) / 1609.344;
    analysis.push(`Tomorrow: ${nextWorkout.type} - ${nextMiles.toFixed(1)} miles.`);
  }

  return analysis;
}

export async function postrunCommand(): Promise<void> {
  const dbPath = process.env.DATABASE_PATH ?? './data/coach.db';

  if (!isDbInitialized(dbPath)) {
    console.log(chalk.yellow('Database not initialized'));
    console.log(`Run ${chalk.cyan('runnn init')} to create the database`);
    return;
  }

  const tzInfo = getTimezone();
  const today = tzInfo.localDate;

  console.log('');
  console.log(chalk.bold('═'.repeat(60)));
  console.log(chalk.bold.cyan('  POST-RUN ANALYSIS'));
  console.log(chalk.bold('═'.repeat(60)));
  console.log('');

  // Step 1: Sync Garmin
  console.log(chalk.cyan('① Syncing Garmin...'));
  try {
    const syncResult = await syncGarmin({ daysBack: 2 });
    if (syncResult.success) {
      console.log(chalk.green(`   ✓ Synced ${syncResult.activitiesSynced} activities`));
    } else {
      console.log(chalk.yellow(`   ⚠ Sync issues: ${syncResult.errors.join(', ')}`));
    }
  } catch (error) {
    console.log(chalk.yellow(`   ⚠ Garmin sync failed - continuing with existing data`));
  }
  console.log('');

  // Step 2: Process voice notes
  console.log(chalk.cyan('② Processing voice notes...'));
  const notesResult = await processRunNotes({ autoLink: true, minScore: 50 });
  if (notesResult.notesProcessed > 0) {
    console.log(chalk.green(`   ✓ Processed ${notesResult.notesProcessed} notes, linked ${notesResult.notesLinked}`));
  } else {
    console.log(chalk.gray('   No pending notes'));
  }
  console.log('');

  // Step 3: Get today's workout
  console.log(chalk.cyan('③ Analyzing your run...'));
  console.log('');

  const workout = queryOne<Workout>(`
    SELECT * FROM workouts
    WHERE local_date = ?
    ORDER BY start_time_utc DESC
    LIMIT 1
  `, [today]);

  if (!workout) {
    console.log(chalk.yellow('  No workout found for today.'));
    console.log(chalk.gray(`  (Looking for ${today} in ${tzInfo.timezone})`));
    console.log('');
    console.log('  Possible reasons:');
    console.log('  • Garmin hasn\'t synced the activity yet');
    console.log('  • The run was recorded on a different date');
    console.log('  • Network connectivity issues');
    console.log('');
    console.log(`  Try: ${chalk.cyan('runnn sync --garmin')} when online`);
    closeDb();
    return;
  }

  // Get planned workout for comparison
  const planned: PlannedWorkout | null = queryOne<PlannedWorkout>(`
    SELECT pw.* FROM planned_workouts pw
    JOIN training_plans tp ON pw.training_plan_id = tp.id
    WHERE tp.status = 'active' AND pw.local_date = ?
    ORDER BY pw.priority ASC
    LIMIT 1
  `, [today]) ?? null;

  // Display actual vs planned
  const actualMiles = (workout.distance_meters || 0) / 1609.344;
  const actualPace = workout.avg_pace_sec_per_mile;

  console.log(chalk.bold('  YOUR RUN'));
  console.log(chalk.gray('  ' + '─'.repeat(50)));
  console.log(`  Distance:  ${chalk.bold(actualMiles.toFixed(2) + ' miles')}`);
  if (workout.duration_seconds) {
    console.log(`  Duration:  ${formatDuration(workout.duration_seconds)}`);
  }
  if (actualPace) {
    console.log(`  Avg Pace:  ${formatPace(actualPace)}`);
  }
  if (workout.avg_hr) {
    console.log(`  Avg HR:    ${workout.avg_hr} bpm`);
  }
  console.log('');

  // Planned comparison
  if (planned) {
    const plannedMiles = (planned.target_distance_meters || 0) / 1609.344;
    console.log(chalk.bold('  PLANNED'));
    console.log(chalk.gray('  ' + '─'.repeat(50)));
    console.log(`  ${planned.type.toUpperCase()} - ${plannedMiles.toFixed(1)} miles`);
    if (planned.prescription) {
      console.log(`  ${planned.prescription}`);
    }
    console.log('');
  }

  // Voice note summary
  if (workout.personal_notes) {
    console.log(chalk.bold('  YOUR NOTES'));
    console.log(chalk.gray('  ' + '─'.repeat(50)));
    console.log(`  "${workout.personal_notes}"`);
    if (workout.perceived_exertion) {
      console.log(`  RPE: ${workout.perceived_exertion}/10`);
    }
    if (workout.mood) {
      console.log(`  Mood: ${workout.mood}`);
    }
    if (workout.discomfort_notes) {
      console.log(chalk.yellow(`  ⚠ Discomfort: ${workout.discomfort_notes}`));
    }
    console.log('');
  }

  // Execution score
  if (planned) {
    const { score, notes } = calculateExecutionScore(planned, workout);

    const scoreColor = score >= 90 ? chalk.green :
                       score >= 75 ? chalk.white :
                       score >= 60 ? chalk.yellow : chalk.red;

    console.log(chalk.bold('  EXECUTION'));
    console.log(chalk.gray('  ' + '─'.repeat(50)));
    console.log(`  Score: ${scoreColor(score + '/100')}`);
    for (const note of notes) {
      console.log(`  • ${note}`);
    }
    console.log('');
  }

  // Calculate this week's mileage (Monday-Sunday training week)
  // Use SQL to find Monday of current week to avoid timezone issues
  const weekStartResult = queryOne<{ week_start: string }>(`
    SELECT date(?, 'weekday 1', '-7 days') as week_start
  `, [today]);
  const weekStart = weekStartResult?.week_start || today;

  const thisWeekWorkouts = query<Workout>(`
    SELECT * FROM workouts
    WHERE local_date >= ? AND local_date <= ?
      AND source = 'garmin'
    ORDER BY local_date
  `, [weekStart, today]);

  const weekMiles = thisWeekWorkouts.reduce((sum, w) =>
    sum + (w.distance_meters || 0) / 1609.344, 0);
  const weekRunCount = thisWeekWorkouts.length;

  // Get tomorrow's planned workout
  const tomorrowResult = queryOne<{ tomorrow: string }>(`
    SELECT date(?, '+1 day') as tomorrow
  `, [today]);
  const tomorrowStr = tomorrowResult?.tomorrow || today;

  const nextWorkout: PlannedWorkout | null = queryOne<PlannedWorkout>(`
    SELECT pw.* FROM planned_workouts pw
    JOIN training_plans tp ON pw.training_plan_id = tp.id
    WHERE tp.status = 'active' AND pw.local_date = ?
    ORDER BY pw.priority ASC
    LIMIT 1
  `, [tomorrowStr]) ?? null;

  const executionScore = planned ? calculateExecutionScore(planned, workout).score : 80;
  const analysis = generateCoachAnalysis(planned, workout, executionScore, weekMiles, weekRunCount, nextWorkout);

  // Store coach notes and execution score to database
  const coachNotesText = analysis.join('\n');
  const db = getDb();
  db.prepare(`
    UPDATE workouts
    SET coach_notes = ?, execution_score = ?, updated_at = datetime('now')
    WHERE id = ?
  `).run(coachNotesText, executionScore, workout.id);

  console.log(chalk.bold.cyan('  COACH NOTES'));
  console.log(chalk.gray('  ' + '─'.repeat(50)));
  for (const line of analysis) {
    console.log(`  ${line}`);
  }
  console.log('');

  console.log(chalk.bold('═'.repeat(60)));
  console.log('');

  closeDb();
}
