#!/usr/bin/env tsx
/**
 * Merge Garmin actual data into LifeOS workout records
 *
 * Strategy:
 * - Match by date (local_date)
 * - Update LifeOS record with Garmin's actual metrics (distance, pace, HR, etc.)
 * - Keep LifeOS title, type, and training plan context
 * - Delete the duplicate Garmin record
 * - For Garmin records with no LifeOS match, keep them as-is
 */

import { config } from 'dotenv';
config();

import { initializeDb, query, execute, closeDb } from '../src/db/client.js';

const dbPath = process.env.DATABASE_PATH ?? './data/coach.db';
initializeDb(dbPath);

interface Workout {
  id: string;
  local_date: string;
  source: string;
  garmin_id: string | null;
  raw_ingest_id: string | null;
  distance_meters: number | null;
  duration_seconds: number | null;
  avg_pace_sec_per_mile: number | null;
  avg_hr: number | null;
  max_hr: number | null;
  cadence: number | null;
  elevation_gain_ft: number | null;
  training_load: number | null;
  training_effect: number | null;
  title: string | null;
  type: string;
}

async function mergeWorkouts() {
  console.log('🔀 Merging Garmin data into LifeOS records...\n');

  // Find all dates that have both Garmin and LifeOS records
  const duplicateDates = query<{ local_date: string; garmin_count: number; lifeos_count: number }>(`
    SELECT
      local_date,
      SUM(CASE WHEN source = 'garmin' THEN 1 ELSE 0 END) as garmin_count,
      SUM(CASE WHEN source = 'lifeos_supabase' THEN 1 ELSE 0 END) as lifeos_count
    FROM workouts
    GROUP BY local_date
    HAVING garmin_count > 0 AND lifeos_count > 0
    ORDER BY local_date DESC
  `);

  console.log(`Found ${duplicateDates.length} dates with both Garmin and LifeOS records\n`);

  let merged = 0;
  let kept = 0;

  for (const { local_date } of duplicateDates) {
    // Get the Garmin record(s) for this date
    const garminWorkouts = query<Workout>(
      `SELECT * FROM workouts WHERE local_date = ? AND source = 'garmin'`,
      [local_date]
    );

    // Get the LifeOS record(s) for this date
    const lifeosWorkouts = query<Workout>(
      `SELECT * FROM workouts WHERE local_date = ? AND source = 'lifeos_supabase'`,
      [local_date]
    );

    // For simplicity, merge the first Garmin into the first LifeOS
    // (Usually there's only one workout per day)
    const garmin = garminWorkouts[0];
    const lifeos = lifeosWorkouts[0];

    if (!garmin || !lifeos) continue;

    // Store garmin data before deleting
    const garminData = {
      garmin_id: garmin.garmin_id,
      distance_meters: garmin.distance_meters,
      duration_seconds: garmin.duration_seconds,
      avg_pace_sec_per_mile: garmin.avg_pace_sec_per_mile,
      avg_hr: garmin.avg_hr,
      max_hr: garmin.max_hr,
      cadence: garmin.cadence,
      elevation_gain_ft: garmin.elevation_gain_ft,
      training_load: garmin.training_load,
      training_effect: garmin.training_effect,
      raw_ingest_id: garmin.raw_ingest_id,
    };

    // Delete the Garmin duplicate FIRST (to free up garmin_id constraint)
    execute(`DELETE FROM workouts WHERE id = ?`, [garmin.id]);

    // Now update LifeOS record with Garmin's actual metrics
    execute(`
      UPDATE workouts SET
        garmin_id = ?,
        distance_meters = COALESCE(?, distance_meters),
        duration_seconds = COALESCE(?, duration_seconds),
        avg_pace_sec_per_mile = COALESCE(?, avg_pace_sec_per_mile),
        avg_hr = COALESCE(?, avg_hr),
        max_hr = COALESCE(?, max_hr),
        cadence = COALESCE(?, cadence),
        elevation_gain_ft = COALESCE(?, elevation_gain_ft),
        training_load = COALESCE(?, training_load),
        training_effect = COALESCE(?, training_effect),
        updated_at = datetime('now')
      WHERE id = ?
    `, [
      garminData.garmin_id,
      garminData.distance_meters,
      garminData.duration_seconds,
      garminData.avg_pace_sec_per_mile,
      garminData.avg_hr,
      garminData.max_hr,
      garminData.cadence,
      garminData.elevation_gain_ft,
      garminData.training_load,
      garminData.training_effect,
      lifeos.id
    ]);

    // Clean up raw_ingest if it was only for this workout
    if (garminData.raw_ingest_id) {
      execute(`DELETE FROM raw_ingest WHERE id = ? AND source = 'garmin'`, [garminData.raw_ingest_id]);
    }

    const garminMiles = garmin.distance_meters ? (garmin.distance_meters / 1609.344).toFixed(1) : '?';
    const lifeosMiles = lifeos.distance_meters ? (lifeos.distance_meters / 1609.344).toFixed(1) : '?';

    console.log(`  ${local_date}: Merged ${garminMiles}mi (actual) into "${lifeos.title?.substring(0, 40) || lifeos.type}" (${lifeosMiles}mi planned)`);
    merged++;

    // Handle additional Garmin workouts on same day (rare)
    for (let i = 1; i < garminWorkouts.length; i++) {
      console.log(`    ⚠ Extra Garmin workout kept: ${(garminWorkouts[i].distance_meters || 0) / 1609.344} mi`);
      kept++;
    }
  }

  // Count remaining Garmin-only records
  const garminOnly = query<{ count: number }>(`
    SELECT COUNT(*) as count FROM workouts
    WHERE source = 'garmin'
    AND local_date NOT IN (
      SELECT local_date FROM workouts WHERE source = 'lifeos_supabase'
    )
  `)[0].count;

  console.log(`\n✅ Merged: ${merged} workouts`);
  console.log(`📍 Garmin-only (no LifeOS match): ${garminOnly}`);

  // Show final stats
  const stats = query<{ source: string; count: number; miles: number }>(`
    SELECT
      source,
      COUNT(*) as count,
      ROUND(SUM(distance_meters)/1609.344, 1) as miles
    FROM workouts
    GROUP BY source
  `);

  console.log('\n📊 Final workout distribution:');
  for (const s of stats) {
    console.log(`  ${s.source}: ${s.count} runs, ${s.miles} miles`);
  }
}

mergeWorkouts()
  .then(() => {
    closeDb();
    process.exit(0);
  })
  .catch((err) => {
    console.error('Error:', err);
    closeDb();
    process.exit(1);
  });
