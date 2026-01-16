#!/usr/bin/env node
/**
 * Pre-Sync Check Hook
 *
 * Validates data integrity before sync operations.
 * Exit code 2 blocks the operation.
 *
 * This script is called by Claude Code hooks before any sync operation.
 */

import { runDoctor } from '../dist/api/doctor.js';

async function main() {
  try {
    console.error('[pre-sync-check] Running data integrity check...');

    const result = await runDoctor({ fix: false });

    if (!result.ok) {
      console.error('[pre-sync-check] Doctor check failed:', result.error?.message);
      // Fail-open: allow sync if doctor check errors
      process.exit(0);
    }

    if (result.data?.has_blocking_errors) {
      console.error('[pre-sync-check] BLOCKED: Data integrity issues detected');
      console.error('[pre-sync-check] Issues:', JSON.stringify(result.data.issues_by_type));
      console.error('[pre-sync-check] Run "runnn doctor --fix" first');
      process.exit(2); // Exit code 2 blocks the operation
    }

    if (result.data?.issues_found > 0) {
      console.error(`[pre-sync-check] Warning: ${result.data.issues_found} non-blocking issues found`);
    } else {
      console.error('[pre-sync-check] Data integrity OK');
    }

    process.exit(0);
  } catch (err) {
    // Fail-open: allow sync if check fails unexpectedly
    console.error('[pre-sync-check] Check failed (allowing sync):', err.message);
    process.exit(0);
  }
}

main();
