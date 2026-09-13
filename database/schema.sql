-- School Feeding System — PostgreSQL schema (Phase 1 foundation)
-- Authoritative central store. Sync/conflict logic is implemented later.

CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ---------------------------------------------------------------------------
-- Core domain (single-school prototype)
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS schools (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name            TEXT NOT NULL,
    location        TEXT,
    version         INTEGER NOT NULL DEFAULT 1,
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    client_id       TEXT,
    last_operation_id TEXT
);

CREATE TABLE IF NOT EXISTS students (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    school_id       UUID NOT NULL REFERENCES schools(id),
    student_code    TEXT NOT NULL,
    full_name       TEXT NOT NULL,
    grade           TEXT,
    is_active       BOOLEAN NOT NULL DEFAULT TRUE,
    version         INTEGER NOT NULL DEFAULT 1,
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    client_id       TEXT,
    last_operation_id TEXT,
    UNIQUE (school_id, student_code)
);

CREATE TABLE IF NOT EXISTS attendance_records (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    school_id       UUID NOT NULL REFERENCES schools(id),
    student_id      UUID NOT NULL REFERENCES students(id),
    attendance_date DATE NOT NULL,
    status          TEXT NOT NULL CHECK (status IN ('present', 'absent', 'excused')),
    version         INTEGER NOT NULL DEFAULT 1,
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    client_id       TEXT,
    last_operation_id TEXT,
    UNIQUE (student_id, attendance_date)
);

CREATE TABLE IF NOT EXISTS meal_distributions (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    school_id       UUID NOT NULL REFERENCES schools(id),
    student_id      UUID NOT NULL REFERENCES students(id),
    distribution_date DATE NOT NULL,
    meal_type       TEXT NOT NULL DEFAULT 'lunch',
    portions        NUMERIC(6, 2) NOT NULL DEFAULT 1,
    version         INTEGER NOT NULL DEFAULT 1,
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    client_id       TEXT,
    last_operation_id TEXT,
    UNIQUE (student_id, distribution_date, meal_type)
);

-- ---------------------------------------------------------------------------
-- Synchronization support (version-based protocol; logic later)
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS sync_operations (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    operation_id    TEXT NOT NULL UNIQUE,
    entity_type     TEXT NOT NULL,
    record_id       UUID NOT NULL,
    operation_type  TEXT NOT NULL CHECK (operation_type IN ('create', 'update', 'delete')),
    payload         JSONB,
    base_version    INTEGER,
    client_id       TEXT NOT NULL,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    status          TEXT NOT NULL DEFAULT 'pending'
                    CHECK (status IN ('pending', 'applied', 'conflict', 'rejected')),
    applied_at      TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS sync_conflicts (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    operation_id    TEXT NOT NULL REFERENCES sync_operations(operation_id),
    entity_type     TEXT NOT NULL,
    record_id       UUID NOT NULL,
    client_base_version INTEGER,
    server_version  INTEGER,
    client_payload  JSONB,
    server_payload  JSONB,
    detected_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    resolution_status TEXT NOT NULL DEFAULT 'unresolved'
                      CHECK (resolution_status IN ('unresolved', 'resolved')),
    resolved_at     TIMESTAMPTZ,
    resolved_by     TEXT
);

CREATE INDEX IF NOT EXISTS idx_attendance_school_date
    ON attendance_records (school_id, attendance_date);

CREATE INDEX IF NOT EXISTS idx_meals_school_date
    ON meal_distributions (school_id, distribution_date);

CREATE INDEX IF NOT EXISTS idx_sync_ops_status
    ON sync_operations (status);

CREATE INDEX IF NOT EXISTS idx_conflicts_unresolved
    ON sync_conflicts (resolution_status);
