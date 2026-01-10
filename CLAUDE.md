# Runnn - Intelligent Run Coach

This is a local-first run coaching system. Claude Code is the coach. The `runnn` CLI is the deterministic tool layer.

## Quick Start

```bash
# Morning readiness check
runnn morning

# After a run
runnn postrun

# Plan the week
runnn plan week

# Debug a recommendation
runnn debug why <decision_id>
```

## Architecture

- **Claude Code** = The coach (reasoning, recommendations, analysis)
- **runnn CLI** = Deterministic tooling (sync, data ops, no LLM)
- **SQLite** = Source of truth (local, WAL mode, append-only events)

## Key Concepts

### Policies
Hard rules that are versioned, tested, and explainable:
- Max weekly ramp rate (10% default)
- When to convert quality → easy
- Travel recovery minimums
- Injury escalation rules

View current policies:
```bash
runnn policy list
```

### Patterns
Discovered correlations unique to you (e.g., "quality sessions 20% better when HRV >45"):
- **candidate**: observed but not trusted yet
- **active**: reliable enough to use
- **retired**: no longer holds

### Overrides
Manual rules that override automation:
- "Ignore HRV for 3 days" (sensor issues)
- "No intervals until calf calm"
- "Max 4 runs this week"

### Events
Every mutation is logged. Rollback is possible:
```bash
runnn rollback --to <event_id>
```

## Data Locations

- `data/coach.db` - SQLite database
- `data/backups/` - Daily backups
- `data/imports/` - Drop FIT/TCX files here
- `~/Library/Mobile Documents/com~apple~CloudDocs/Runnn/run-notes/` - Voice notes from iOS

## Daily Workflow

1. **Morning**: `runnn morning` → readiness + today's workout
2. **Run**: Garmin captures the data
3. **Post-run**: Record voice note (iOS Shortcut) → `runnn postrun`
4. **Weekly**: `runnn plan week` on Sunday/Monday

## Important Commands

| Command | Purpose |
|---------|---------|
| `runnn sync` | Sync Garmin + process notes (idempotent) |
| `runnn doctor` | Check data quality, detect anomalies |
| `runnn doctor --fix` | Auto-repair safe issues |
| `runnn policy validate` | Test policy changes before applying |
| `runnn export` | Backup/export data |

## Configuration

Edit `runnn.yaml` for:
- Units (miles/km)
- Timezone
- Injury sensitivities
- Shoe rotation
- Coach style preferences

## Safety Notes

- This is **not medical advice**. Chest pain, dizziness, or injury-level pain → seek professional care.
- All data stays local. External APIs (Whisper) only see redacted content in standard mode.
- Raw audio and health data never leave your machine.
