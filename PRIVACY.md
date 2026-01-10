# Runnn Privacy Policy

This document describes what data Runnn stores, processes, and transmits.

## Core Principle

**Local-first**: Your data stays on your machine by default. External services are optional and redacted.

## Privacy Modes

Set in `runnn.yaml` or `.env`:

| Mode | Transcription | External APIs | Logging |
|------|---------------|---------------|---------|
| `strict` | Local only (Whisper.cpp) | None | Minimal |
| `standard` | Whisper API (redacted) | Weather lookup (optional) | Standard |
| `verbose` | Whisper API (redacted) | All enabled | Full debug |

## Data Classification

### Never Leaves Your Machine

| Data Type | Storage | Notes |
|-----------|---------|-------|
| Raw audio files | `run-notes/audio/` | Voice memos stay local |
| Raw transcriptions | `raw_ingest` table | Before redaction |
| Health data | `health_snapshots` | HRV, RHR, sleep, body battery |
| Injury details | `injury_status` | Location, severity |
| Personal notes | `workouts.personal_notes` | After redaction applied |
| Coach sessions | `coach_sessions` | Full conversation context |

### May Be Sent to External Services (Standard Mode)

| Data Type | Service | Redaction Applied |
|-----------|---------|-------------------|
| Audio transcription | OpenAI Whisper | N/A (audio itself) |
| Cleaned transcription | None | Names, addresses, phone numbers stripped |
| Weather lookup | Weather API | Only location (city) + date |
| Calendar (optional) | Google Calendar | Only busy/free times, no titles |

## Redaction Rules

Before any data is sent to external APIs, the redaction pass removes:

1. **Names**: First names, last names, nicknames
2. **Addresses**: Street addresses, cities (except for weather lookup)
3. **Phone numbers**: Any phone-like patterns
4. **Email addresses**: user@domain patterns
5. **Medical details**: Specific diagnoses, medications

### Example

**Raw transcription**:
> "Met up with John at Griffith Park. Did 8 miles, felt good. My left calf is tight again, might need to see Dr. Smith."

**After redaction**:
> "Met up with [PERSON] at [LOCATION]. Did 8 miles, felt good. My left calf is tight again, might need to see [PERSON]."

## Storage Locations

| Location | Contents | Encrypted |
|----------|----------|-----------|
| `data/coach.db` | All structured data | No (local only) |
| `data/backups/` | Daily database copies | No |
| `run-notes/audio/` | Voice memos | No |
| `run-notes/inbox/` | Transcription JSONs | No |
| `.env` | API keys | No (never committed) |

## External API Usage

### OpenAI Whisper (Standard Mode)

- **What's sent**: Audio file
- **What's returned**: Transcription text
- **Retention**: OpenAI's standard API retention policy
- **Opt-out**: Use `strict` privacy mode

### Weather API (Optional)

- **What's sent**: City name + date
- **What's returned**: Temperature, humidity, conditions
- **Purpose**: Annotate historical runs with weather context

### Garmin Connect (Required)

- **What's sent**: Your credentials (to Garmin)
- **What's returned**: Activities, sleep, HRV, RHR
- **Note**: Uses unofficial API; credentials stored in `.env`

## Data Retention

- **Workouts**: Permanent (your training history)
- **Health snapshots**: Permanent
- **Events**: Permanent (audit trail)
- **Raw ingest**: Permanent (enables reprocessing)
- **Coach sessions**: Permanent (enables "why did you say that")
- **Backups**: 30 days (configurable)

## Data Deletion

To delete your data:

```bash
# Delete database (irreversible)
rm data/coach.db data/coach.db-wal data/coach.db-shm

# Delete backups
rm -rf data/backups/*

# Delete run notes
rm -rf ~/Library/Mobile\ Documents/com~apple~CloudDocs/Runnn/run-notes/*
```

## Audit Trail

Every data change is logged in the `events` table:

```sql
SELECT timestamp_utc, entity_type, action, source
FROM events
ORDER BY timestamp_utc DESC
LIMIT 10;
```

This enables:
- Seeing what changed and when
- Rollback to previous states
- Debugging unexpected behavior

## Third-Party Services Summary

| Service | Purpose | Data Shared | Required |
|---------|---------|-------------|----------|
| Garmin Connect | Sync runs, health | Credentials | Yes |
| OpenAI Whisper | Transcription | Audio files | No (strict mode) |
| Weather API | Historical weather | City + date | No |
| Google Calendar | Travel detection | Busy/free times | No |

## Questions

If you have questions about privacy, check:

1. `runnn.yaml` → `privacy_mode` setting
2. `src/privacy/redactor.ts` → redaction rules
3. `src/privacy/audit.ts` → what's logged when data leaves

## Updates

This privacy policy is versioned with the codebase. Changes are tracked in git history.
