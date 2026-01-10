/**
 * Sync command - Sync Garmin data and process run notes
 */

import chalk from 'chalk';
import { isDbInitialized, closeDb } from '../db/client.js';
import { syncGarmin, getSyncState } from '../connectors/garmin.js';
import { processRunNotes, scanInbox } from '../connectors/run-notes.js';

interface SyncOptions {
  garmin?: boolean;
  notes?: boolean;
  force?: boolean;
  verbose?: boolean;
}

export async function syncCommand(options: SyncOptions): Promise<void> {
  const dbPath = process.env.DATABASE_PATH ?? './data/coach.db';

  if (!isDbInitialized(dbPath)) {
    console.log(chalk.yellow('Database not initialized'));
    console.log(`Run ${chalk.cyan('runnn init')} to create the database`);
    return;
  }

  const doSyncGarmin = options.garmin || (!options.garmin && !options.notes);
  const doSyncNotes = options.notes || (!options.garmin && !options.notes);

  console.log(chalk.bold('Syncing data...'));
  if (options.verbose) {
    console.log(`  Garmin: ${doSyncGarmin ? 'Yes' : 'No'}`);
    console.log(`  Notes: ${doSyncNotes ? 'Yes' : 'No'}`);
    console.log(`  Force: ${options.force ? 'Yes' : 'No'}`);
  }
  console.log('');

  let totalActivities = 0;
  let totalNotes = 0;
  let hasErrors = false;

  if (doSyncGarmin) {
    console.log(chalk.blue('Syncing Garmin data...'));

    const syncState = getSyncState();
    if (options.verbose && syncState?.last_success_at_utc) {
      console.log(`  Last successful sync: ${syncState.last_success_at_utc}`);
    }

    const result = await syncGarmin({ force: options.force });

    if (result.success) {
      console.log(chalk.green(`  Activities synced: ${result.activitiesSynced}`));
      console.log(chalk.green(`  Health data synced: ${result.healthSnapshotsSynced}`));
      totalActivities = result.activitiesSynced;
    } else {
      hasErrors = true;
      for (const error of result.errors) {
        console.log(chalk.red(`  Error: ${error}`));
      }
    }
  }

  if (doSyncNotes) {
    console.log('');
    console.log(chalk.blue('Processing run notes...'));

    const pendingNotes = scanInbox();
    if (pendingNotes.length === 0) {
      console.log(chalk.gray('  No pending notes in inbox'));
    } else {
      console.log(`  Found ${pendingNotes.length} pending note(s)`);

      const result = await processRunNotes({ autoLink: true });

      if (result.notesProcessed > 0) {
        console.log(chalk.green(`  Processed: ${result.notesProcessed}`));
        console.log(chalk.green(`  Linked: ${result.notesLinked}`));
        totalNotes = result.notesLinked;
      }

      if (result.pendingMatches.length > 0) {
        console.log(chalk.yellow(`  Needs manual matching: ${result.pendingMatches.length}`));
        for (const pending of result.pendingMatches) {
          if (pending.candidates.length === 0) {
            console.log(chalk.gray(`    ${pending.noteId}: No matching workouts found`));
          } else {
            console.log(chalk.gray(`    ${pending.noteId}: ${pending.candidates.length} candidate(s)`));
            if (options.verbose) {
              for (const c of pending.candidates) {
                console.log(chalk.gray(`      - ${c.workout.local_date} (score: ${c.score})`));
              }
            }
          }
        }
      }

      if (result.errors.length > 0) {
        hasErrors = true;
        for (const error of result.errors) {
          console.log(chalk.red(`  Error: ${error}`));
        }
      }
    }
  }

  console.log('');
  if (hasErrors) {
    console.log(chalk.yellow('Sync completed with errors'));
  } else {
    console.log(chalk.green('Sync complete'));
    if (options.verbose) {
      console.log(`  Activities: ${totalActivities}`);
      console.log(`  Notes linked: ${totalNotes}`);
    }
  }

  closeDb();
}
