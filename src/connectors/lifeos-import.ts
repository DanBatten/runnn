/**
 * LifeOS Import - One-time migration from LifeOS to RunV2
 *
 * Imports:
 * - Workouts
 * - Health snapshots
 * - Training plans/phases
 *
 * Principle: Store raw data first, then reprocess
 */

import { nanoid } from 'nanoid';
import { createHash } from 'crypto';
import { insertWithEvent, query, initializeDb, closeDb } from '../db/client.js';
import { readFileSync, existsSync } from 'fs';

interface LifeOSWorkout {
  id: string;
  user_id: string;
  activity_id: string;
  start_time: string;
  local_date: string;
  name: string;
  type: string;
  distance_meters: number | null;
  duration_seconds: number | null;
  avg_pace_minutes_per_km: number | null;
  avg_hr: number | null;
  max_hr: number | null;
  calories: number | null;
  elevation_gain: number | null;
  training_load: number | null;
  training_effect: number | null;
  avg_cadence: number | null;
  device_name: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

interface LifeOSHealthSnapshot {
  id: string;
  user_id: string;
  date: string;
  sleep_hours: number | null;
  sleep_score: number | null;
  hrv: number | null;
  resting_hr: number | null;
  body_battery: number | null;
  stress_avg: number | null;
  steps: number | null;
  active_calories: number | null;
  notes: string | null;
  created_at: string;
}

interface LifeOSTrainingPlan {
  id: string;
  user_id: string;
  name: string;
  race_date: string | null;
  race_distance: string | null;
  goal_time: string | null;
  status: string;
  start_date: string | null;
  end_date: string | null;
  created_at: string;
}

interface LifeOSTrainingPhase {
  id: string;
  training_plan_id: string;
  name: string;
  phase_type: string;
  start_date: string;
  end_date: string;
  focus: string | null;
  target_mileage: number | null;
  notes: string | null;
}

interface ImportResult {
  success: boolean;
  workoutsImported: number;
  healthSnapshotsImported: number;
  trainingPlansImported: number;
  errors: string[];
}

/**
 * Generate hash for deduplication
 */
function hashData(data: unknown): string {
  return createHash('sha256')
    .update(JSON.stringify(data))
    .digest('hex')
    .slice(0, 32);
}

/**
 * Convert pace from min/km to sec/mile
 */
function paceMinKmToSecMile(minPerKm: number | null): number | null {
  if (minPerKm === null || minPerKm === 0) return null;
  // 1 km = 0.621371 miles
  // minPerKm * (1/0.621371) * 60 = sec/mile
  return Math.round(minPerKm * 60 * 1.60934);
}

/**
 * Convert elevation from meters to feet
 */
function metersToFeet(meters: number | null): number | null {
  if (meters === null) return null;
  return Math.round(meters * 3.28084);
}

/**
 * Map LifeOS workout type to RunV2 type
 */
function mapWorkoutType(lifeosType: string): string {
  const typeMap: Record<string, string> = {
    easy: 'easy',
    recovery: 'easy',
    long: 'long',
    tempo: 'tempo',
    threshold: 'tempo',
    interval: 'interval',
    speedwork: 'interval',
    race: 'race',
  };
  return typeMap[lifeosType.toLowerCase()] || 'easy';
}

/**
 * Import a single workout from LifeOS format
 */
function importWorkout(workout: LifeOSWorkout): string | null {
  // Store raw ingest first
  const rawId = nanoid();
  const payloadHash = hashData(workout);

  // Check if already imported
  const existing = query<{ id: string }>(
    'SELECT id FROM raw_ingest WHERE source_id = ? AND source = ?',
    [workout.id, 'lifeos_import']
  );

  if (existing.length > 0) {
    return null; // Already imported
  }

  insertWithEvent(
    'raw_ingest',
    {
      id: rawId,
      source: 'lifeos_import',
      source_id: workout.id,
      received_at_utc: new Date().toISOString(),
      payload_json: JSON.stringify(workout),
      payload_hash: payloadHash,
      status: 'processed',
    },
    { source: 'lifeos_import' }
  );

  // Create workout record
  const workoutId = nanoid();

  // Parse timezone from start_time if available (assume UTC for LifeOS data)
  const timezoneOffsetMin = -480; // Default to PST, adjust as needed

  insertWithEvent(
    'workouts',
    {
      id: workoutId,
      garmin_id: workout.activity_id || null,
      raw_ingest_id: rawId,
      start_time_utc: workout.start_time,
      timezone_offset_min: timezoneOffsetMin,
      local_date: workout.local_date,
      type: mapWorkoutType(workout.type),
      distance_meters: workout.distance_meters,
      duration_seconds: workout.duration_seconds,
      avg_pace_sec_per_mile: paceMinKmToSecMile(workout.avg_pace_minutes_per_km),
      avg_hr: workout.avg_hr,
      max_hr: workout.max_hr,
      cadence: workout.avg_cadence,
      elevation_gain_ft: metersToFeet(workout.elevation_gain),
      training_effect: workout.training_effect,
      training_load: workout.training_load,
      device: workout.device_name,
      source: 'lifeos_import',
      personal_notes: workout.notes,
    },
    { source: 'lifeos_import' }
  );

  return workoutId;
}

/**
 * Import a health snapshot from LifeOS format
 */
function importHealthSnapshot(snapshot: LifeOSHealthSnapshot): boolean {
  // Check if already exists for this date
  const existing = query<{ local_date: string }>(
    'SELECT local_date FROM health_snapshots WHERE local_date = ?',
    [snapshot.date]
  );

  if (existing.length > 0) {
    return false; // Already exists
  }

  // Store raw ingest
  const rawId = nanoid();

  insertWithEvent(
    'raw_ingest',
    {
      id: rawId,
      source: 'lifeos_import',
      source_id: snapshot.id,
      received_at_utc: new Date().toISOString(),
      payload_json: JSON.stringify(snapshot),
      payload_hash: hashData(snapshot),
      status: 'processed',
    },
    { source: 'lifeos_import' }
  );

  // Create health snapshot
  insertWithEvent(
    'health_snapshots',
    {
      local_date: snapshot.date,
      timezone_offset_min: -480, // Default to PST
      sleep_hours: snapshot.sleep_hours,
      sleep_quality: snapshot.sleep_score,
      hrv: snapshot.hrv,
      resting_hr: snapshot.resting_hr,
      body_battery: snapshot.body_battery,
      stress_level: snapshot.stress_avg,
      steps: snapshot.steps,
      raw_ingest_id: rawId,
    },
    { source: 'lifeos_import' }
  );

  return true;
}

/**
 * Import a training plan from LifeOS format
 */
function importTrainingPlan(
  plan: LifeOSTrainingPlan,
  phases: LifeOSTrainingPhase[]
): string | null {
  // Check if already imported
  const existing = query<{ id: string }>(
    'SELECT id FROM raw_ingest WHERE source_id = ? AND source = ?',
    [plan.id, 'lifeos_import']
  );

  if (existing.length > 0) {
    return null;
  }

  // Store raw ingest
  const rawId = nanoid();

  insertWithEvent(
    'raw_ingest',
    {
      id: rawId,
      source: 'lifeos_import',
      source_id: plan.id,
      received_at_utc: new Date().toISOString(),
      payload_json: JSON.stringify({ plan, phases }),
      payload_hash: hashData({ plan, phases }),
      status: 'processed',
    },
    { source: 'lifeos_import' }
  );

  // Create training plan
  const planId = nanoid();

  // Parse goal time to seconds if available
  let goalTimeSeconds: number | null = null;
  if (plan.goal_time) {
    const parts = plan.goal_time.split(':').map(Number);
    if (parts.length === 3) {
      goalTimeSeconds = parts[0] * 3600 + parts[1] * 60 + parts[2];
    } else if (parts.length === 2) {
      goalTimeSeconds = parts[0] * 60 + parts[1];
    }
  }

  insertWithEvent(
    'training_plans',
    {
      id: planId,
      name: plan.name,
      start_local_date: plan.start_date || plan.created_at.slice(0, 10),
      end_local_date: plan.end_date || plan.race_date || plan.created_at.slice(0, 10),
      primary_goal: plan.race_distance ? `${plan.race_distance}` : null,
      goal_time_seconds: goalTimeSeconds,
      status: plan.status === 'active' ? 'active' : 'completed',
      notes: null,
    },
    { source: 'lifeos_import' }
  );

  // Import phases as training blocks
  for (const phase of phases) {
    const blockId = nanoid();

    insertWithEvent(
      'training_blocks',
      {
        id: blockId,
        training_plan_id: planId,
        name: phase.name,
        block_type: phase.phase_type.toLowerCase(),
        start_local_date: phase.start_date,
        end_local_date: phase.end_date,
        focus: phase.focus,
        weekly_target_miles: phase.target_mileage,
      },
      { source: 'lifeos_import' }
    );
  }

  return planId;
}

/**
 * Import from a JSON export file
 */
export async function importFromJsonFile(filePath: string): Promise<ImportResult> {
  const result: ImportResult = {
    success: false,
    workoutsImported: 0,
    healthSnapshotsImported: 0,
    trainingPlansImported: 0,
    errors: [],
  };

  if (!existsSync(filePath)) {
    result.errors.push(`File not found: ${filePath}`);
    return result;
  }

  try {
    const content = readFileSync(filePath, 'utf-8');
    const data = JSON.parse(content);

    // Import workouts
    if (data.workouts && Array.isArray(data.workouts)) {
      console.log(`  Found ${data.workouts.length} workouts`);
      for (const workout of data.workouts) {
        try {
          const id = importWorkout(workout);
          if (id) {
            result.workoutsImported++;
          }
        } catch (error) {
          result.errors.push(`Workout ${workout.id}: ${error}`);
        }
      }
    }

    // Import health snapshots
    if (data.health_snapshots && Array.isArray(data.health_snapshots)) {
      console.log(`  Found ${data.health_snapshots.length} health snapshots`);
      for (const snapshot of data.health_snapshots) {
        try {
          const imported = importHealthSnapshot(snapshot);
          if (imported) {
            result.healthSnapshotsImported++;
          }
        } catch (error) {
          result.errors.push(`Health snapshot ${snapshot.id}: ${error}`);
        }
      }
    }

    // Import training plans
    if (data.training_plans && Array.isArray(data.training_plans)) {
      console.log(`  Found ${data.training_plans.length} training plans`);
      const phases = data.training_phases || [];

      for (const plan of data.training_plans) {
        try {
          const planPhases = phases.filter(
            (p: LifeOSTrainingPhase) => p.training_plan_id === plan.id
          );
          const id = importTrainingPlan(plan, planPhases);
          if (id) {
            result.trainingPlansImported++;
          }
        } catch (error) {
          result.errors.push(`Training plan ${plan.id}: ${error}`);
        }
      }
    }

    result.success = result.errors.length === 0;
  } catch (error) {
    result.errors.push(`Parse error: ${error}`);
  }

  return result;
}

/**
 * CLI handler for import command
 */
export async function importLifeOSCommand(
  inputPath: string,
  options: { verbose?: boolean }
): Promise<void> {
  const chalk = (await import('chalk')).default;

  const dbPath = process.env.DATABASE_PATH ?? './data/coach.db';

  // Initialize DB if needed
  const { isDbInitialized } = await import('../db/client.js');
  if (!isDbInitialized(dbPath)) {
    console.log(chalk.blue('Initializing database...'));
    initializeDb(dbPath);
  }

  console.log(chalk.bold('Importing from LifeOS'));
  console.log(`  Source: ${inputPath}`);
  console.log('');

  const result = await importFromJsonFile(inputPath);

  if (result.success) {
    console.log(chalk.green('Import completed successfully!'));
  } else {
    console.log(chalk.yellow('Import completed with errors'));
  }

  console.log('');
  console.log('Summary:');
  console.log(`  Workouts: ${result.workoutsImported}`);
  console.log(`  Health snapshots: ${result.healthSnapshotsImported}`);
  console.log(`  Training plans: ${result.trainingPlansImported}`);

  if (result.errors.length > 0) {
    console.log('');
    console.log(chalk.red(`Errors (${result.errors.length}):`));
    const displayErrors = options.verbose ? result.errors : result.errors.slice(0, 5);
    for (const error of displayErrors) {
      console.log(chalk.red(`  - ${error}`));
    }
    if (!options.verbose && result.errors.length > 5) {
      console.log(chalk.gray(`  ... and ${result.errors.length - 5} more`));
    }
  }

  closeDb();
}

/**
 * Export instructions for creating LifeOS JSON export
 */
export function printExportInstructions(): void {
  console.log(`
To export data from LifeOS (Supabase), run these queries:

1. Export workouts:
   SELECT * FROM workouts WHERE user_id = '[YOUR_USER_ID]'

2. Export health snapshots:
   SELECT * FROM health_snapshots WHERE user_id = '[YOUR_USER_ID]'

3. Export training plans:
   SELECT * FROM training_plans WHERE user_id = '[YOUR_USER_ID]'

4. Export training phases:
   SELECT * FROM training_phases

Combine into a JSON file with this structure:
{
  "workouts": [...],
  "health_snapshots": [...],
  "training_plans": [...],
  "training_phases": [...]
}

Then run:
  runnn import-lifeos /path/to/export.json
`);
}
