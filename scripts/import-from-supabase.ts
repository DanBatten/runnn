#!/usr/bin/env tsx
/**
 * Direct Import from LifeOS Supabase Database
 *
 * Reads directly from LifeOS Supabase and imports into runnn SQLite
 */

import { createClient } from '@supabase/supabase-js';
import { readFileSync, existsSync } from 'fs';
import { resolve } from 'path';
import { nanoid } from 'nanoid';
import { createHash } from 'crypto';

// Load LifeOS .env.local for Supabase credentials
const lifeosEnvPath = resolve(process.env.HOME!, 'Projects/LifeOS/.env.local');

if (!existsSync(lifeosEnvPath)) {
  console.error('Could not find LifeOS .env.local at:', lifeosEnvPath);
  process.exit(1);
}

// Parse .env.local
const envContent = readFileSync(lifeosEnvPath, 'utf-8');
const envVars: Record<string, string> = {};
for (const line of envContent.split('\n')) {
  const match = line.match(/^([^#=]+)=(.*)$/);
  if (match) {
    envVars[match[1].trim()] = match[2].trim();
  }
}

const SUPABASE_URL = envVars.SUPABASE_URL;
const SUPABASE_SERVICE_KEY = envVars.SUPABASE_SERVICE_KEY;
const USER_ID = envVars.USER_ID;

if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY || !USER_ID) {
  console.error('Missing required env vars: SUPABASE_URL, SUPABASE_SERVICE_KEY, USER_ID');
  process.exit(1);
}

// Initialize Supabase client
const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

// Initialize runnn database
import { initializeDb, insertWithEvent, query, closeDb, getDb } from '../src/db/client.js';

const dbPath = process.env.DATABASE_PATH ?? './data/coach.db';
initializeDb(dbPath);

function hashData(data: unknown): string {
  return createHash('sha256').update(JSON.stringify(data)).digest('hex').slice(0, 32);
}

function paceMinKmToSecMile(minPerKm: number | null): number | null {
  if (minPerKm === null || minPerKm === 0) return null;
  return Math.round(minPerKm * 60 * 1.60934);
}

function metersToFeet(meters: number | null): number | null {
  if (meters === null) return null;
  return Math.round(meters * 3.28084);
}

function milesToMeters(miles: number | null): number | null {
  if (miles === null) return null;
  return Math.round(miles * 1609.34);
}

function paceStringToSecPerMile(paceStr: string | null): number | null {
  if (!paceStr) return null;
  // Parse "8:30/mi" or "8:30" format
  const match = paceStr.match(/(\d+):(\d+)/);
  if (!match) return null;
  return parseInt(match[1]) * 60 + parseInt(match[2]);
}

function clampRpe(rpe: unknown): number | null {
  // Handle null, undefined, empty string
  if (rpe === null || rpe === undefined || rpe === '' || rpe === 0) return null;

  // Convert to number if it's a string
  const numRpe = typeof rpe === 'string' ? parseFloat(rpe) : Number(rpe);

  // Handle NaN or non-finite values
  if (!Number.isFinite(numRpe) || numRpe === 0) return null;

  // Clamp to valid range
  if (numRpe < 1) return 1;
  if (numRpe > 10) return 10;
  return Math.round(numRpe);
}

function clampExecutionScore(score: unknown): number | null {
  // Handle null, undefined, empty string
  if (score === null || score === undefined || score === '') return null;

  // Convert to number if it's a string
  const numScore = typeof score === 'string' ? parseFloat(score) : Number(score);

  // Handle NaN or non-finite values
  if (!Number.isFinite(numScore)) return null;

  // Clamp to valid range (0-100)
  if (numScore < 0) return 0;
  if (numScore > 100) return 100;
  return Math.round(numScore);
}

async function importWorkouts() {
  console.log('\n📊 Importing workouts...');

  const { data: workouts, error } = await supabase
    .from('workouts')
    .select('*')
    .eq('user_id', USER_ID)
    .order('scheduled_date', { ascending: true });

  if (error) {
    console.error('Error fetching workouts:', error.message);
    return 0;
  }

  if (!workouts || workouts.length === 0) {
    console.log('  No workouts found');
    return 0;
  }

  console.log(`  Found ${workouts.length} workouts`);

  let imported = 0;
  let skipped = 0;

  for (const workout of workouts) {
    // Check if already imported
    const existing = query<{ id: string }>(
      'SELECT id FROM raw_ingest WHERE source_id = ? AND source = ?',
      [workout.id, 'lifeos_supabase']
    );

    if (existing.length > 0) {
      skipped++;
      continue;
    }

    try {

      if ((rawPe !== null && rawPe !== undefined) || (rawEs !== null && rawEs !== undefined)) {
        console.log(`  DEBUG: workout ${workout.id.slice(0,8)} PE: ${rawPe}→${clampedPe}, ES: ${rawEs}→${clampedEs}`);
      }

      // Store raw ingest
      const rawId = nanoid();
      insertWithEvent(
        'raw_ingest',
        {
          id: rawId,
          source: 'lifeos_supabase',
          source_id: workout.id,
          received_at_utc: new Date().toISOString(),
          payload_json: JSON.stringify(workout),
          payload_hash: hashData(workout),
          status: 'processed',
        },
        { source: 'lifeos_supabase_import' }
      );

      // Create workout record
      const workoutId = nanoid();
      // LifeOS uses scheduled_date, completed_at, etc.
      const localDate = workout.scheduled_date || workout.completed_at?.split('T')[0] || new Date().toISOString().split('T')[0];
      const startTimeUtc = workout.completed_at || workout.scheduled_date + 'T12:00:00Z';

      // Map workout type
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
      const workoutType = typeMap[(workout.type || '').toLowerCase()] || 'easy';

      insertWithEvent(
        'workouts',
        {
          id: workoutId,
          garmin_id: workout.garmin_activity_id || null,
          raw_ingest_id: rawId,
          start_time_utc: startTimeUtc,
          timezone_offset_min: -480, // PST default
          local_date: localDate,
          type: workoutType,
          distance_meters: milesToMeters(workout.distance_miles) || workout.distance_meters,
          duration_seconds: workout.duration_seconds || (workout.duration_minutes ? workout.duration_minutes * 60 : null),
          avg_pace_sec_per_mile: paceStringToSecPerMile(workout.avg_pace) || paceMinKmToSecMile(workout.avg_pace_minutes_per_km),
          avg_hr: workout.avg_hr || workout.heart_rate_avg,
          max_hr: workout.max_hr || workout.heart_rate_max,
          cadence: workout.cadence_avg,
          elevation_gain_ft: workout.elevation_gain_ft || metersToFeet(workout.elevation_gain),
          training_effect: workout.training_effect || workout.training_effect_aerobic,
          training_load: workout.training_load,
          device: workout.device_name,
          source: 'lifeos_supabase',
          temperature_f: workout.temperature_f,
          humidity_pct: workout.humidity_pct,
          weather_summary: workout.weather_conditions,
          surface: workout.terrain_type,
          perceived_exertion: clampRpe(workout.perceived_exertion ?? workout.rpe ?? workout.effort ?? workout.perceived_difficulty),
          personal_notes: workout.personal_notes || workout.notes,
          discomfort_notes: workout.discomfort_notes,
          discomfort_locations: workout.discomfort_locations ? JSON.stringify(workout.discomfort_locations) : null,
          coach_notes: workout.coach_notes,
          execution_score: clampExecutionScore(workout.execution_score),
          splits: workout.splits ? JSON.stringify(workout.splits) : null,
        },
        { source: 'lifeos_supabase_import' }
      );

      imported++;
    } catch (err) {
      console.error(`  Error importing workout ${workout.id}:`, err);
    }
  }

  console.log(`  ✓ Imported: ${imported}, Skipped (existing): ${skipped}`);
  return imported;
}

async function importHealthSnapshots() {
  console.log('\n❤️ Importing health snapshots...');

  const { data: snapshots, error } = await supabase
    .from('health_snapshots')
    .select('*')
    .eq('user_id', USER_ID)
    .order('snapshot_date', { ascending: true });

  if (error) {
    console.error('Error fetching health snapshots:', error.message);
    return 0;
  }

  if (!snapshots || snapshots.length === 0) {
    console.log('  No health snapshots found');
    return 0;
  }

  console.log(`  Found ${snapshots.length} health snapshots`);

  let imported = 0;
  let skipped = 0;

  for (const snapshot of snapshots) {
    // Check if already imported (either in raw_ingest or health_snapshots)
    const existingRaw = query<{ id: string }>(
      'SELECT id FROM raw_ingest WHERE source_id = ? AND source = ?',
      [snapshot.id, 'lifeos_supabase']
    );

    if (existingRaw.length > 0) {
      skipped++;
      continue;
    }

    const snapshotDate = snapshot.snapshot_date;
    const existingSnapshot = query<{ local_date: string }>(
      'SELECT local_date FROM health_snapshots WHERE local_date = ?',
      [snapshotDate]
    );

    if (existingSnapshot.length > 0) {
      skipped++;
      continue;
    }

    try {
      // Store raw ingest
      const rawId = nanoid();
      insertWithEvent(
        'raw_ingest',
        {
          id: rawId,
          source: 'lifeos_supabase',
          source_id: snapshot.id,
          received_at_utc: new Date().toISOString(),
          payload_json: JSON.stringify(snapshot),
          payload_hash: hashData(snapshot),
          status: 'processed',
        },
        { source: 'lifeos_supabase_import' }
      );

      // Create health snapshot (uses local_date as PK, not id)
      const db = getDb();
      db.prepare(`
        INSERT INTO health_snapshots (
          local_date, timezone_offset_min, sleep_hours, sleep_quality,
          hrv, resting_hr, body_battery, stress_level, steps, raw_ingest_id
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        snapshotDate,
        -480,
        snapshot.sleep_hours ?? null,
        snapshot.sleep_score ?? snapshot.sleep_quality ?? null,
        snapshot.hrv ?? snapshot.hrv_rmssd ?? null,
        snapshot.resting_hr ?? null,
        snapshot.body_battery ?? snapshot.body_battery_morning ?? null,
        snapshot.stress_avg ?? null,
        snapshot.steps ?? null,
        rawId
      );

      imported++;
    } catch (err) {
      console.error(`  Error importing health snapshot ${snapshot.id}:`, err);
    }
  }

  console.log(`  ✓ Imported: ${imported}, Skipped (existing): ${skipped}`);
  return imported;
}

async function importTrainingPlans() {
  console.log('\n📋 Importing training plans...');

  const { data: plans, error } = await supabase
    .from('training_plans')
    .select('*')
    .eq('user_id', USER_ID);

  if (error) {
    console.error('Error fetching training plans:', error.message);
    return 0;
  }

  if (!plans || plans.length === 0) {
    console.log('  No training plans found');
    return 0;
  }

  console.log(`  Found ${plans.length} training plans`);

  // Get phases
  const { data: phases } = await supabase
    .from('training_phases')
    .select('*');

  let imported = 0;
  let skipped = 0;

  for (const plan of plans) {
    // Check if already imported
    const existing = query<{ id: string }>(
      'SELECT id FROM raw_ingest WHERE source_id = ? AND source = ?',
      [plan.id, 'lifeos_supabase']
    );

    if (existing.length > 0) {
      skipped++;
      continue;
    }

    try {
      // Store raw ingest
      const rawId = nanoid();
      const planPhases = phases?.filter(p => p.plan_id === plan.id) || [];

      insertWithEvent(
        'raw_ingest',
        {
          id: rawId,
          source: 'lifeos_supabase',
          source_id: plan.id,
          received_at_utc: new Date().toISOString(),
          payload_json: JSON.stringify({ plan, phases: planPhases }),
          payload_hash: hashData({ plan, phases: planPhases }),
          status: 'processed',
        },
        { source: 'lifeos_supabase_import' }
      );

      // Create training plan
      const planId = nanoid();
      insertWithEvent(
        'training_plans',
        {
          id: planId,
          name: plan.name,
          start_local_date: plan.start_date,
          end_local_date: plan.end_date,
          primary_goal: plan.goal_event,
          goal_time_seconds: plan.goal_time_seconds,
          status: plan.status === 'active' ? 'active' : 'completed',
          notes: plan.description,
        },
        { source: 'lifeos_supabase_import' }
      );

      // Import phases as training blocks
      for (const phase of planPhases) {
        const blockId = nanoid();
        insertWithEvent(
          'training_blocks',
          {
            id: blockId,
            training_plan_id: planId,
            name: phase.name,
            block_type: (phase.phase_type || 'base').toLowerCase(),
            start_local_date: phase.start_date,
            end_local_date: phase.end_date,
            focus: phase.focus_areas ? phase.focus_areas.join(', ') : null,
            weekly_target_miles: phase.weekly_volume_target_miles,
          },
          { source: 'lifeos_supabase_import' }
        );
      }

      imported++;
    } catch (err) {
      console.error(`  Error importing training plan ${plan.id}:`, err);
    }
  }

  console.log(`  ✓ Imported: ${imported}, Skipped (existing): ${skipped}`);
  return imported;
}

async function main() {
  console.log('═'.repeat(50));
  console.log('  LifeOS → Runnn Direct Import');
  console.log('═'.repeat(50));
  console.log(`\nSupabase URL: ${SUPABASE_URL}`);
  console.log(`User ID: ${USER_ID}`);

  const workoutsImported = await importWorkouts();
  const healthImported = await importHealthSnapshots();
  const plansImported = await importTrainingPlans();

  console.log('\n' + '═'.repeat(50));
  console.log('  Import Summary');
  console.log('═'.repeat(50));
  console.log(`  Workouts:         ${workoutsImported}`);
  console.log(`  Health Snapshots: ${healthImported}`);
  console.log(`  Training Plans:   ${plansImported}`);
  console.log('═'.repeat(50));

  closeDb();
}

main().catch(console.error);
