# Runnn Runbook

Operational procedures for running, maintaining, and troubleshooting Runnn.

## Daily Operations

### Automatic Sync (Cron)

Add to crontab for automatic morning sync:

```bash
# Edit crontab
crontab -e

# Add these lines:
# Sync Garmin data at 6:00 AM
0 6 * * * cd /path/to/runnn && npm run cli sync >> /tmp/runnn-sync.log 2>&1

# Run doctor at 6:05 AM
5 6 * * * cd /path/to/runnn && npm run cli doctor >> /tmp/runnn-doctor.log 2>&1
```

### Manual Sync

```bash
# Full sync (Garmin + run notes)
runnn sync

# Garmin only
runnn sync --garmin

# Run notes only
runnn sync --notes

# Force re-sync (ignore cursor)
runnn sync --force
```

## Backups

### Create Backup

```bash
# Manual backup
runnn export --backup

# Automated daily backups (add to cron)
0 2 * * * cd /path/to/runnn && npm run db:backup
```

### Restore from Backup

```bash
# List available backups
ls -la data/backups/

# Restore (creates new events, doesn't rewrite history)
npm run db:restore -- --from data/backups/coach-2026-01-09.db

# Verify restore
runnn doctor
```

### Weekly Restore Drill

Every week, verify backups work:

```bash
# Copy to temp location
cp data/backups/coach-latest.db /tmp/restore-test.db

# Verify it opens
sqlite3 /tmp/restore-test.db ".tables"

# Verify data integrity
sqlite3 /tmp/restore-test.db "SELECT COUNT(*) FROM workouts"

# Clean up
rm /tmp/restore-test.db
```

## Data Quality

### Doctor Checks

```bash
# Run all checks
runnn doctor

# Run with verbose output
runnn doctor --verbose

# Auto-fix safe issues
runnn doctor --fix

# Check schema/prompt compatibility
runnn doctor --compat
```

### Common Issues

| Issue | Fix |
|-------|-----|
| Missing health snapshot | Check Garmin sync, may need manual entry |
| Duplicate workouts | `runnn doctor --fix` marks as duplicate |
| Orphaned run note | `runnn doctor --fix` re-attempts matching |
| Impossible pace | Flagged for manual review |

### Manual Data Fixes

```bash
# Open SQLite directly (read-only recommended)
sqlite3 -readonly data/coach.db

# Check events for an entity
SELECT * FROM events WHERE entity_id = 'workout-123' ORDER BY timestamp_utc;

# View open data issues
SELECT * FROM data_issues WHERE status = 'open';
```

## Policy Management

### View Policies

```bash
# List all policies
runnn policy list

# View specific policy
runnn policy show weekly-ramp-rate

# View policy tests
runnn policy tests weekly-ramp-rate
```

### Change Policies

```bash
# Propose a change (creates draft)
runnn policy propose weekly-ramp-rate --max-ramp 15

# Validate (runs tests)
runnn policy validate

# Apply if tests pass
runnn policy apply

# Rollback if needed
runnn policy rollback weekly-ramp-rate --to-version 1
```

## Rollback

### Rollback to Event

```bash
# View recent events
sqlite3 data/coach.db "SELECT id, timestamp_utc, entity_type, action FROM events ORDER BY timestamp_utc DESC LIMIT 20"

# Rollback to specific event (additive, creates new events)
runnn rollback --to <event_id>

# Rollback last N mutations
runnn rollback --last 5
```

### What Can Be Rolled Back

- Workouts (edits to subjective fields)
- Planned workouts
- Patterns (status changes)
- Knowledge entries
- Overrides

### What Cannot Be Rolled Back

- `raw_ingest` (permanent record)
- `events` (append-only ledger)
- `coach_sessions` (audit trail)

## Troubleshooting

### Garmin Sync Fails

1. Check credentials in `.env`
2. Garmin may have rate-limited; wait 1 hour
3. Check for 2FA/captcha requirements (log into web first)
4. Try `runnn sync --force` to reset cursor

### Run Notes Not Matching

1. Check timestamp proximity (default: 4 hours)
2. Verify timezone settings match
3. Use `runnn sync --notes --verbose` to see matching logic
4. Manually link via: `runnn link-note <note_id> <workout_id>`

### Database Locked

1. Check for other processes: `lsof data/coach.db`
2. WAL checkpoint: `sqlite3 data/coach.db "PRAGMA wal_checkpoint(TRUNCATE)"`
3. Increase busy_timeout in client

### Schema Migration Issues

1. Check current version: `sqlite3 data/coach.db "SELECT * FROM schema_versions ORDER BY applied_at DESC LIMIT 1"`
2. Run pending migrations: `npm run db:migrate`
3. If stuck, restore from backup

## Performance

### Database Size

```bash
# Check size
du -h data/coach.db

# Vacuum (reclaim space after deletes)
sqlite3 data/coach.db "VACUUM"

# Analyze (update query planner statistics)
sqlite3 data/coach.db "ANALYZE"
```

### Event Log Growth

Events are append-only. If size becomes an issue:

```bash
# Archive old events (keep last 90 days in main table)
# NOT YET IMPLEMENTED - events table should be pruned carefully
```

## Security

### Secrets

- Never commit `.env`
- Use macOS keychain for production secrets
- Rotate Garmin password if exposed

### Database Encryption

SQLite encryption is optional. If needed, use SQLCipher:

```bash
# Not implemented by default - data stays local
```
