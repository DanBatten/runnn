#!/bin/bash
#
# Lock Run - Single Writer Discipline
#
# Prevents overlapping coach operations to avoid SQLite contention.
# Usage: ./scripts/lock-run.sh <command> [args...]
#
# Example: ./scripts/lock-run.sh claude -p "Check my readiness"
#

set -e

LOCKFILE="/tmp/runnn-coach.lock"
SCRIPT_NAME=$(basename "$0")

# Check if command provided
if [ $# -eq 0 ]; then
    echo "Usage: $SCRIPT_NAME <command> [args...]" >&2
    exit 1
fi

# Create lock file descriptor
exec 200>"$LOCKFILE"

# Try to acquire lock (non-blocking)
if ! flock -n 200; then
    echo "[$SCRIPT_NAME] Another coach operation is running. Exiting." >&2
    exit 1
fi

# Log start
echo "[$SCRIPT_NAME] Acquired lock, running: $*" >&2

# Run the command
"$@"
EXIT_CODE=$?

# Release lock (automatic on script exit, but be explicit)
flock -u 200

echo "[$SCRIPT_NAME] Released lock, exit code: $EXIT_CODE" >&2
exit $EXIT_CODE
