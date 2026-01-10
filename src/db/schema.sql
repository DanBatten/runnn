-- RunV2 Database Schema
-- Version: 1.0.0
--
-- Design principles:
-- - Local-first (SQLite with WAL mode)
-- - Append-only events for audit trail
-- - Raw ingest preserved for reprocessing
-- - Time-aware fields for travel handling

-- Enable WAL mode and sane settings
PRAGMA journal_mode = WAL;
PRAGMA busy_timeout = 5000;
PRAGMA foreign_keys = ON;
PRAGMA synchronous = NORMAL;

-- ===========================================
-- SCHEMA VERSIONS: Track migrations
-- ===========================================
CREATE TABLE IF NOT EXISTS schema_versions (
    version TEXT PRIMARY KEY,
    applied_at TEXT NOT NULL DEFAULT (datetime('now')),
    description TEXT,
    migration_hash TEXT
);

-- Insert initial version
INSERT OR IGNORE INTO schema_versions (version, description)
VALUES ('1.0.0', 'Initial schema with all core tables');

-- ===========================================
-- RAW INGEST: Store original payloads for reprocessing
-- ===========================================
CREATE TABLE IF NOT EXISTS raw_ingest (
    id TEXT PRIMARY KEY,
    source TEXT NOT NULL,           -- garmin, run_note, import_fit
    source_id TEXT,                 -- garmin activity id, filename, etc.
    received_at_utc TEXT NOT NULL DEFAULT (datetime('now')),
    payload_json TEXT,              -- raw json when available
    file_path TEXT,                 -- raw file location (e.g. .fit)
    payload_hash TEXT,              -- dedupe + idempotency
    status TEXT NOT NULL DEFAULT 'pending',  -- pending, processed, error
    error_message TEXT,

    UNIQUE(source, payload_hash)
);

CREATE INDEX IF NOT EXISTS raw_ingest_source_idx ON raw_ingest(source, source_id);
CREATE INDEX IF NOT EXISTS raw_ingest_hash_idx ON raw_ingest(payload_hash);
CREATE INDEX IF NOT EXISTS raw_ingest_status_idx ON raw_ingest(status);

-- ===========================================
-- SYNC STATE: Track connector cursors
-- ===========================================
CREATE TABLE IF NOT EXISTS sync_state (
    source TEXT PRIMARY KEY,
    cursor TEXT,
    last_success_at_utc TEXT,
    last_error_at_utc TEXT,
    last_error_message TEXT
);

-- ===========================================
-- EVENTS: Append-only mutation ledger
-- ===========================================
CREATE TABLE IF NOT EXISTS events (
    id TEXT PRIMARY KEY,
    timestamp_utc TEXT NOT NULL DEFAULT (datetime('now')),
    entity_type TEXT NOT NULL,
    entity_id TEXT NOT NULL,
    action TEXT NOT NULL,           -- create, update, delete, rollback_applied
    before_hash TEXT,
    after_hash TEXT,
    diff_json TEXT,
    source TEXT NOT NULL,           -- session_id, tool_name, sync, manual
    reason TEXT
);

CREATE INDEX IF NOT EXISTS events_entity_idx ON events(entity_type, entity_id);
CREATE INDEX IF NOT EXISTS events_timestamp_idx ON events(timestamp_utc);

-- ===========================================
-- SETTINGS: Explicit athlete configuration
-- ===========================================
CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL,
    description TEXT,
    updated_at TEXT DEFAULT (datetime('now'))
);

-- Insert default settings
INSERT OR IGNORE INTO settings (key, value, description) VALUES
    ('units', '"miles"', 'Distance units: miles or km'),
    ('timezone', '"America/Los_Angeles"', 'Local timezone'),
    ('max_days_running_per_week', '6', 'Maximum running days per week'),
    ('preferred_long_run_day', '"sunday"', 'Preferred day for long runs'),
    ('hr_zones_preference', '"lactate_threshold"', 'HR zone calculation method'),
    ('privacy_mode', '"standard"', 'Privacy mode: strict, standard, verbose');

-- ===========================================
-- TRAINING PLANS: Structure + phases + goals
-- ===========================================
CREATE TABLE IF NOT EXISTS training_plans (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    start_local_date TEXT NOT NULL,
    end_local_date TEXT NOT NULL,
    primary_goal TEXT,
    goal_time_seconds INTEGER,
    status TEXT DEFAULT 'active',   -- draft, active, completed
    notes TEXT,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS training_plans_status_idx ON training_plans(status);

-- ===========================================
-- TRAINING BLOCKS: base/build/taper within a plan
-- ===========================================
CREATE TABLE IF NOT EXISTS training_blocks (
    id TEXT PRIMARY KEY,
    training_plan_id TEXT REFERENCES training_plans(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    block_type TEXT,                -- base, build, peak, taper, recovery
    start_local_date TEXT NOT NULL,
    end_local_date TEXT NOT NULL,
    focus TEXT,
    weekly_target_miles REAL,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS training_blocks_plan_idx ON training_blocks(training_plan_id);

-- ===========================================
-- RACES: Long-horizon goals
-- ===========================================
CREATE TABLE IF NOT EXISTS races (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    distance_meters REAL NOT NULL,
    race_date TEXT NOT NULL,
    priority TEXT NOT NULL,         -- A, B, C
    course_profile TEXT,            -- flat, rolling, hilly, mountainous
    expected_temp_f INTEGER,
    expected_humidity_pct INTEGER,
    goal_time_seconds INTEGER,
    result_time_seconds INTEGER,
    result_notes TEXT,
    training_plan_id TEXT REFERENCES training_plans(id) ON DELETE SET NULL,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS races_date_idx ON races(race_date);

-- ===========================================
-- FITNESS TESTS: Calibration points
-- ===========================================
CREATE TABLE IF NOT EXISTS fitness_tests (
    id TEXT PRIMARY KEY,
    test_type TEXT NOT NULL,        -- time_trial, threshold_test, vo2max, lactate
    distance_meters REAL,
    local_date TEXT NOT NULL,
    result_time_seconds INTEGER,
    result_pace_sec_per_mile REAL,
    result_hr_avg INTEGER,
    result_hr_threshold INTEGER,
    notes TEXT,
    workout_id TEXT,                -- Linked after workout table created
    created_at TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS fitness_tests_date_idx ON fitness_tests(local_date);

-- ===========================================
-- PACE ZONES: Computed from tests
-- ===========================================
CREATE TABLE IF NOT EXISTS pace_zones (
    id TEXT PRIMARY KEY,
    effective_date TEXT NOT NULL,
    source TEXT,                    -- fitness_test_id, manual, race_result
    easy_pace_low REAL,             -- sec/mile
    easy_pace_high REAL,
    steady_pace_low REAL,
    steady_pace_high REAL,
    tempo_pace_low REAL,
    tempo_pace_high REAL,
    threshold_pace REAL,
    interval_pace REAL,
    easy_hr_low INTEGER,
    easy_hr_high INTEGER,
    tempo_hr_low INTEGER,
    tempo_hr_high INTEGER,
    threshold_hr INTEGER,
    notes TEXT,
    created_at TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS pace_zones_date_idx ON pace_zones(effective_date);

-- ===========================================
-- PLANNED WORKOUTS: What you intended to do
-- ===========================================
CREATE TABLE IF NOT EXISTS planned_workouts (
    id TEXT PRIMARY KEY,
    training_plan_id TEXT REFERENCES training_plans(id) ON DELETE CASCADE,
    training_block_id TEXT REFERENCES training_blocks(id) ON DELETE SET NULL,
    local_date TEXT NOT NULL,
    type TEXT,                      -- easy, tempo, interval, long, race, rest
    priority TEXT,                  -- A, B, C
    target_distance_meters REAL,
    target_duration_seconds INTEGER,
    target_pace_sec_per_mile REAL,
    target_hr_zone TEXT,
    prescription TEXT,              -- human-readable workout description
    rationale TEXT,                 -- why this workout exists
    status TEXT DEFAULT 'planned',  -- planned, completed, skipped, moved
    workout_id TEXT,                -- link when completed
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS planned_workouts_date_idx ON planned_workouts(local_date);
CREATE INDEX IF NOT EXISTS planned_workouts_status_idx ON planned_workouts(status);

-- ===========================================
-- WORKOUTS: Every run with objective + subjective data
-- ===========================================
CREATE TABLE IF NOT EXISTS workouts (
    id TEXT PRIMARY KEY,
    garmin_id TEXT UNIQUE,
    raw_ingest_id TEXT REFERENCES raw_ingest(id) ON DELETE SET NULL,

    -- Time-aware fields (critical for travel)
    start_time_utc TEXT NOT NULL,
    timezone_offset_min INTEGER NOT NULL,
    local_date TEXT NOT NULL,

    type TEXT,                      -- easy, tempo, interval, long, race
    title TEXT,

    -- From Garmin
    distance_meters REAL,
    duration_seconds INTEGER,
    avg_pace_sec_per_mile REAL,
    avg_hr INTEGER,
    max_hr INTEGER,
    cadence INTEGER,
    elevation_gain_ft INTEGER,
    training_effect REAL,
    training_load INTEGER,
    device TEXT,
    source TEXT,                    -- garmin, import_fit, manual

    -- Environmental context
    temperature_f INTEGER,
    humidity_pct INTEGER,
    weather_summary TEXT,
    surface TEXT,                   -- road, trail, treadmill, track
    terrain TEXT,                   -- flat, rolling, hilly, mountainous
    wind TEXT,                      -- calm, light, moderate, strong

    -- From Voice Notes (subjective)
    perceived_exertion INTEGER CHECK (perceived_exertion IS NULL OR (perceived_exertion BETWEEN 1 AND 10)),
    personal_notes TEXT,
    discomfort_notes TEXT,
    discomfort_locations TEXT,      -- JSON array
    mood TEXT,

    -- Coach Analysis
    coach_notes TEXT,
    execution_score INTEGER CHECK (execution_score IS NULL OR (execution_score BETWEEN 0 AND 100)),

    -- Structured data
    splits TEXT,                    -- JSON
    laps TEXT,                      -- JSON
    metadata TEXT,                  -- JSON

    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS workouts_local_date_idx ON workouts(local_date);
CREATE INDEX IF NOT EXISTS workouts_start_time_idx ON workouts(start_time_utc);
CREATE INDEX IF NOT EXISTS workouts_garmin_idx ON workouts(garmin_id);

-- Add foreign key to fitness_tests now that workouts exists
-- (SQLite doesn't support ALTER TABLE ADD CONSTRAINT, so this is handled at app level)

-- Add foreign key to planned_workouts now that workouts exists
-- (handled at app level)

-- ===========================================
-- HEALTH SNAPSHOTS: Daily biometrics
-- ===========================================
CREATE TABLE IF NOT EXISTS health_snapshots (
    local_date TEXT PRIMARY KEY,
    timezone_offset_min INTEGER NOT NULL,

    sleep_hours REAL,
    sleep_quality INTEGER CHECK (sleep_quality IS NULL OR (sleep_quality BETWEEN 1 AND 10)),
    hrv INTEGER,
    hrv_status TEXT,
    resting_hr INTEGER,
    body_battery INTEGER,
    stress_level INTEGER,
    steps INTEGER,

    raw_ingest_id TEXT REFERENCES raw_ingest(id) ON DELETE SET NULL,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now'))
);

-- ===========================================
-- LIFE EVENTS: Travel, illness, stress
-- ===========================================
CREATE TABLE IF NOT EXISTS life_events (
    id TEXT PRIMARY KEY,
    local_date TEXT NOT NULL,
    event_type TEXT NOT NULL,       -- travel, illness, stress, sleep_disruption, family
    severity INTEGER CHECK (severity IS NULL OR (severity BETWEEN 1 AND 10)),
    duration_days INTEGER,
    timezone_change_hours INTEGER,
    notes TEXT,
    created_at TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS life_events_date_idx ON life_events(local_date);

-- ===========================================
-- STRENGTH SESSIONS: Cross-training
-- ===========================================
CREATE TABLE IF NOT EXISTS strength_sessions (
    id TEXT PRIMARY KEY,
    local_date TEXT NOT NULL,
    session_type TEXT,              -- gym, home, yoga, mobility
    duration_minutes INTEGER,
    perceived_exertion INTEGER CHECK (perceived_exertion IS NULL OR (perceived_exertion BETWEEN 1 AND 10)),
    soreness_next_day INTEGER CHECK (soreness_next_day IS NULL OR (soreness_next_day BETWEEN 1 AND 10)),
    focus_areas TEXT,               -- JSON array
    notes TEXT,
    created_at TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS strength_sessions_date_idx ON strength_sessions(local_date);

-- ===========================================
-- INJURY STATUS: Track injuries over time
-- ===========================================
CREATE TABLE IF NOT EXISTS injury_status (
    id TEXT PRIMARY KEY,
    local_date TEXT NOT NULL,
    location TEXT NOT NULL,         -- left_calf, right_knee, etc.
    severity INTEGER NOT NULL CHECK (severity BETWEEN 1 AND 10),
    trend TEXT,                     -- improving, stable, worsening
    limits_running INTEGER DEFAULT 0,
    notes TEXT,
    created_at TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS injury_status_date_idx ON injury_status(local_date);
CREATE INDEX IF NOT EXISTS injury_status_location_idx ON injury_status(location);

-- ===========================================
-- ATHLETE KNOWLEDGE: What coach has learned
-- ===========================================
CREATE TABLE IF NOT EXISTS athlete_knowledge (
    id TEXT PRIMARY KEY,
    type TEXT NOT NULL,             -- preference, response_pattern, life_factor
    category TEXT NOT NULL,         -- training, recovery, schedule, injury
    key TEXT NOT NULL UNIQUE,
    value TEXT NOT NULL,            -- JSON
    confidence REAL DEFAULT 0.5 CHECK (confidence BETWEEN 0 AND 1),
    evidence_count INTEGER DEFAULT 1,
    source TEXT NOT NULL,           -- observed, stated, inferred
    first_observed_at TEXT DEFAULT (datetime('now')),
    last_confirmed_at TEXT DEFAULT (datetime('now')),
    is_active INTEGER DEFAULT 1,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS athlete_knowledge_active_idx ON athlete_knowledge(is_active);
CREATE INDEX IF NOT EXISTS athlete_knowledge_type_idx ON athlete_knowledge(type, category);

-- ===========================================
-- DISCOVERED PATTERNS: Learned correlations
-- ===========================================
CREATE TABLE IF NOT EXISTS discovered_patterns (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    type TEXT NOT NULL,             -- threshold, cause_effect, correlation
    domain TEXT NOT NULL,           -- training, recovery, performance
    description TEXT NOT NULL,
    conditions TEXT NOT NULL,       -- JSON
    expected_outcome TEXT NOT NULL, -- JSON

    status TEXT DEFAULT 'candidate', -- candidate, active, retired

    evidence TEXT,                  -- JSON: supporting and contradicting ids
    observations INTEGER DEFAULT 0,
    confirmations INTEGER DEFAULT 0,

    last_evaluated_at TEXT,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS discovered_patterns_status_idx ON discovered_patterns(status);
CREATE INDEX IF NOT EXISTS discovered_patterns_domain_idx ON discovered_patterns(domain);

-- ===========================================
-- POLICIES: Versioned coaching rules
-- ===========================================
CREATE TABLE IF NOT EXISTS policies (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL UNIQUE,
    version INTEGER NOT NULL DEFAULT 1,
    rules TEXT NOT NULL,            -- JSON
    summary TEXT NOT NULL,
    is_active INTEGER DEFAULT 1,
    created_at TEXT DEFAULT (datetime('now')),
    activated_at TEXT
);

CREATE INDEX IF NOT EXISTS policies_active_idx ON policies(is_active);

-- ===========================================
-- POLICY TESTS: Fixtures for testing policies
-- ===========================================
CREATE TABLE IF NOT EXISTS policy_tests (
    id TEXT PRIMARY KEY,
    policy_id TEXT NOT NULL REFERENCES policies(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    fixture TEXT NOT NULL,          -- JSON: input context
    expected_output TEXT NOT NULL,  -- JSON: expected decision
    last_run_at TEXT,
    last_result TEXT                -- pass, fail
);

CREATE INDEX IF NOT EXISTS policy_tests_policy_idx ON policy_tests(policy_id);

-- ===========================================
-- PROMPT VERSIONS: Track prompt compatibility
-- ===========================================
CREATE TABLE IF NOT EXISTS prompt_versions (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    version INTEGER NOT NULL,
    hash TEXT NOT NULL,
    changelog TEXT,
    required_fields TEXT,           -- JSON: what schema fields this expects
    required_tools TEXT,            -- JSON: what tools this expects
    created_at TEXT DEFAULT (datetime('now')),

    UNIQUE(name, version)
);

-- ===========================================
-- COACH SESSIONS: Reproducible interactions
-- ===========================================
CREATE TABLE IF NOT EXISTS coach_sessions (
    id TEXT PRIMARY KEY,
    started_at_utc TEXT NOT NULL DEFAULT (datetime('now')),
    user_intent TEXT,
    user_prompt TEXT,
    tool_calls TEXT,                -- JSON
    context_summary TEXT,
    policies_applied TEXT,          -- JSON: policy IDs + versions
    policy_hash TEXT,
    recommendations TEXT,           -- JSON
    predictions TEXT,               -- JSON: expected RPE, HR, pace, next-day readiness
    model_info TEXT,
    prompt_version_id TEXT REFERENCES prompt_versions(id) ON DELETE SET NULL,
    user_feedback INTEGER CHECK (user_feedback IS NULL OR (user_feedback BETWEEN 1 AND 5)),
    feedback_tags TEXT,             -- JSON: ["too_aggressive", "ignored_life_context"]
    created_at TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS coach_sessions_started_idx ON coach_sessions(started_at_utc);

-- ===========================================
-- COACHING DECISIONS: Decision audit trail
-- ===========================================
CREATE TABLE IF NOT EXISTS coaching_decisions (
    id TEXT PRIMARY KEY,
    coach_session_id TEXT REFERENCES coach_sessions(id) ON DELETE SET NULL,
    date TEXT NOT NULL,
    type TEXT NOT NULL,             -- adaptation, prescription, recommendation
    situation TEXT NOT NULL,        -- JSON
    decision TEXT NOT NULL,         -- JSON
    reasoning TEXT NOT NULL,

    was_followed INTEGER,
    outcome_assessed_at TEXT,
    outcome_success REAL CHECK (outcome_success IS NULL OR (outcome_success BETWEEN 0 AND 1)),
    outcome_notes TEXT,
    lesson_learned TEXT,

    workout_id TEXT REFERENCES workouts(id) ON DELETE SET NULL,
    created_at TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS coaching_decisions_date_idx ON coaching_decisions(date);
CREATE INDEX IF NOT EXISTS coaching_decisions_workout_idx ON coaching_decisions(workout_id);
CREATE INDEX IF NOT EXISTS coaching_decisions_session_idx ON coaching_decisions(coach_session_id);

-- ===========================================
-- OVERRIDES: Manual rules
-- ===========================================
CREATE TABLE IF NOT EXISTS overrides (
    id TEXT PRIMARY KEY,
    override_type TEXT NOT NULL,    -- ignore_metric, schedule_change, intensity_limit, injury_protocol
    description TEXT NOT NULL,
    rules TEXT NOT NULL,            -- JSON
    starts_at TEXT NOT NULL,
    expires_at TEXT,
    is_active INTEGER DEFAULT 1,
    reason TEXT,
    created_at TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS overrides_active_idx ON overrides(is_active);

-- ===========================================
-- DATA ISSUES: Anomalies and problems
-- ===========================================
CREATE TABLE IF NOT EXISTS data_issues (
    id TEXT PRIMARY KEY,
    detected_at TEXT NOT NULL DEFAULT (datetime('now')),
    issue_type TEXT NOT NULL,       -- impossible_pace, sensor_error, duplicate, missing_link, etc.
    severity TEXT NOT NULL,         -- warning, error, critical
    entity_type TEXT,
    entity_id TEXT,
    description TEXT NOT NULL,
    suggested_fix TEXT,
    status TEXT DEFAULT 'open',     -- open, ignored, fixed
    fixed_at TEXT,
    fixed_by TEXT                   -- tool, manual
);

CREATE INDEX IF NOT EXISTS data_issues_status_idx ON data_issues(status);
CREATE INDEX IF NOT EXISTS data_issues_entity_idx ON data_issues(entity_type, entity_id);

-- ===========================================
-- DERIVED: Weekly summaries
-- ===========================================
CREATE TABLE IF NOT EXISTS weekly_summaries (
    week_start_date TEXT PRIMARY KEY,
    total_distance_meters REAL,
    total_duration_seconds INTEGER,
    run_count INTEGER,
    intensity_distribution TEXT,    -- JSON
    plan_adherence_pct REAL,
    avg_execution_score REAL,
    training_load_total INTEGER,
    notes TEXT,
    computed_at TEXT DEFAULT (datetime('now'))
);

-- ===========================================
-- DERIVED: Readiness baselines
-- ===========================================
CREATE TABLE IF NOT EXISTS readiness_baselines (
    local_date TEXT PRIMARY KEY,
    hrv_7day_avg REAL,
    rhr_7day_avg REAL,
    sleep_7day_avg REAL,
    hrv_30day_avg REAL,
    rhr_30day_avg REAL,
    sleep_30day_avg REAL,
    computed_at TEXT DEFAULT (datetime('now'))
);

-- ===========================================
-- VIEWS: Convenience queries
-- ===========================================

-- Active patterns only
CREATE VIEW IF NOT EXISTS v_active_patterns AS
SELECT
    id,
    name,
    type,
    domain,
    description,
    conditions,
    expected_outcome,
    observations,
    confirmations,
    CASE
        WHEN observations > 0 THEN CAST(confirmations AS REAL) / observations
        ELSE 0.5
    END as confirmation_rate,
    last_evaluated_at
FROM discovered_patterns
WHERE status = 'active';

-- Recent workouts with plan context
CREATE VIEW IF NOT EXISTS v_recent_workouts AS
SELECT
    w.*,
    pw.prescription as planned_prescription,
    pw.target_distance_meters as planned_distance,
    pw.target_pace_sec_per_mile as planned_pace,
    pw.priority as workout_priority
FROM workouts w
LEFT JOIN planned_workouts pw ON w.id = pw.workout_id
ORDER BY w.local_date DESC
LIMIT 30;

-- Open data issues
CREATE VIEW IF NOT EXISTS v_open_issues AS
SELECT *
FROM data_issues
WHERE status = 'open'
ORDER BY
    CASE severity
        WHEN 'critical' THEN 1
        WHEN 'error' THEN 2
        WHEN 'warning' THEN 3
    END,
    detected_at DESC;

-- Active overrides
CREATE VIEW IF NOT EXISTS v_active_overrides AS
SELECT *
FROM overrides
WHERE is_active = 1
  AND starts_at <= datetime('now')
  AND (expires_at IS NULL OR expires_at > datetime('now'))
ORDER BY starts_at DESC;
