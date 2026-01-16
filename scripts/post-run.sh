#!/bin/bash
#
# Post-Run - Headless Sync and Analysis
#
# Syncs new workout data and provides analysis.
# Uses narrow write tools (sync only) for safety.
#
# Usage: ./scripts/post-run.sh
#
# Typically triggered after Garmin sync completes or manually after a run.
#

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
LOG_DIR="$PROJECT_DIR/logs"

# Ensure log directory exists
mkdir -p "$LOG_DIR"

# Change to project directory
cd "$PROJECT_DIR"

# Generate idempotency key for this run
IDEMPOTENCY_KEY="post-run-$(date +%Y%m%d-%H%M%S)"

# Run with lock to prevent overlapping operations
"$SCRIPT_DIR/lock-run.sh" claude -p \
  "Post-run sync and analysis. Please:
   1. Sync my latest workout data (use idempotency_key: $IDEMPOTENCY_KEY)
   2. Analyze the session (pace, HR, execution)
   3. Note any concerns or highlights
   4. Suggest recovery timeline" \
  --allowedTools "mcp__runnn-coach__coach_read_*,mcp__runnn-coach__coach_write_sync" \
  --output-format stream-json \
  2>&1 | tee -a "$LOG_DIR/post-run.log"
