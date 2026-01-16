#!/bin/bash
#
# Morning Coach - Headless Readiness Check
#
# Gets morning readiness assessment and today's workout recommendation.
# Uses READ-ONLY tools only for safety in automated context.
#
# Usage: ./scripts/morning-coach.sh
#
# Can be scheduled via:
# - cron: 0 6 * * * /path/to/morning-coach.sh
# - launchd: ~/Library/LaunchAgents/com.runnn.morning-coach.plist
#

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
LOG_DIR="$PROJECT_DIR/logs"

# Ensure log directory exists
mkdir -p "$LOG_DIR"

# Change to project directory
cd "$PROJECT_DIR"

# Run with lock to prevent overlapping operations
"$SCRIPT_DIR/lock-run.sh" claude -p \
  "Good morning! Check my readiness and tell me today's recommended workout. Include:
   1. Readiness status (HRV, sleep, recovery)
   2. Today's planned workout
   3. Any modifications based on readiness
   4. Quick recommendation (go/easy/rest)" \
  --allowedTools "mcp__runnn-coach__coach_read_*" \
  --output-format stream-json \
  2>&1 | tee -a "$LOG_DIR/morning-coach.log"
