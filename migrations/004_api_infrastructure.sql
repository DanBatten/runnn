-- Migration 004: API Infrastructure
-- Version: 1.4.0
-- Description: Add tables for API layer (decisions, locks, idempotency)
--
-- Tables added:
-- - decisions: First-class decision records for audit and reproducibility
-- - active_locks: Write lock tracking for concurrency control
-- - idempotency_keys: Idempotency key storage for write operations

-- ===========================================
-- DECISIONS: First-class decision records
-- Every recommendation persists inputs + policies + output
-- ===========================================
CREATE TABLE IF NOT EXISTS decisions (
    id TEXT PRIMARY KEY,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    decision_type TEXT NOT NULL,        -- today_workout, plan_create, plan_week, etc.
    inputs_json TEXT NOT NULL,          -- Serialized inputs used for decision
    output_json TEXT NOT NULL,          -- Serialized output/recommendation
    policy_versions_json TEXT NOT NULL, -- List of policy IDs that were applied
    trace_id TEXT NOT NULL,             -- Request trace ID for debugging
    explanation_id TEXT,                -- Optional link to detailed explanation

    -- Indexes for common queries
    UNIQUE(trace_id)
);

CREATE INDEX IF NOT EXISTS decisions_type_idx ON decisions(decision_type);
CREATE INDEX IF NOT EXISTS decisions_created_idx ON decisions(created_at);
CREATE INDEX IF NOT EXISTS decisions_trace_idx ON decisions(trace_id);

-- ===========================================
-- ACTIVE LOCKS: Write lock tracking
-- Used for debugging and monitoring, not enforcement
-- (enforcement is via in-memory queue)
-- ===========================================
CREATE TABLE IF NOT EXISTS active_locks (
    id TEXT PRIMARY KEY,
    operation TEXT NOT NULL,            -- sync, plan_create, etc.
    trace_id TEXT NOT NULL,             -- Request trace ID
    acquired_at TEXT NOT NULL DEFAULT (datetime('now')),

    UNIQUE(trace_id)
);

CREATE INDEX IF NOT EXISTS active_locks_operation_idx ON active_locks(operation);
CREATE INDEX IF NOT EXISTS active_locks_acquired_idx ON active_locks(acquired_at);

-- ===========================================
-- IDEMPOTENCY KEYS: Dedupe write operations
-- ===========================================
CREATE TABLE IF NOT EXISTS idempotency_keys (
    key TEXT PRIMARY KEY,
    result_json TEXT NOT NULL,          -- Cached result
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    expires_at TEXT NOT NULL            -- TTL for cleanup
);

CREATE INDEX IF NOT EXISTS idempotency_expires_idx ON idempotency_keys(expires_at);

-- ===========================================
-- Update schema version
-- ===========================================
INSERT OR REPLACE INTO schema_versions (version, description, applied_at)
VALUES ('1.4.0', 'API infrastructure: decisions, locks, idempotency', datetime('now'));
