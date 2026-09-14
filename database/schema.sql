-- School Feeding System — PostgreSQL schema (Phase 2)
-- Authoritative central store for one-school prototype, extensible to more schools.
-- Synchronization processing, conflict resolution, and forecasting are later phases.
--
-- Apply against a new database named school_feeding.
-- CREATE TABLE IF NOT EXISTS will not reshape tables from the earlier placeholder
-- schema; drop and recreate the database if that placeholder was already loaded.

CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ---------------------------------------------------------------------------
-- Users
-- Roles are limited to the prototype: admin and school_staff.
-- password_hash stores a one-way hash only (never plain text).
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS users (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name            TEXT NOT NULL,
    email           TEXT NOT NULL,
    password_hash   TEXT NOT NULL,
    role            TEXT NOT NULL,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT users_email_unique UNIQUE (email),
    CONSTRAINT users_email_format CHECK (
        email ~* '^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$'
    ),
    CONSTRAINT users_role_check CHECK (role IN ('admin', 'school_staff')),
    CONSTRAINT users_password_hash_present CHECK (char_length(password_hash) >= 20)
);

-- ---------------------------------------------------------------------------
-- Schools
-- Prototype uses one selected school; school_id on child tables allows more later.
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS schools (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name            TEXT NOT NULL,
    location        TEXT,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Optional school roster from the architecture phase (not used by daily totals).
CREATE TABLE IF NOT EXISTS students (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    school_id       UUID NOT NULL,
    student_code    TEXT NOT NULL,
    full_name       TEXT NOT NULL,
    grade           TEXT,
    is_active       BOOLEAN NOT NULL DEFAULT TRUE,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT students_school_fk
        FOREIGN KEY (school_id) REFERENCES schools (id)
        ON UPDATE CASCADE
        ON DELETE RESTRICT,
    CONSTRAINT students_school_code_unique UNIQUE (school_id, student_code)
);

-- ---------------------------------------------------------------------------
-- Attendance (daily school-level counts for the feeding programme)
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS attendance_records (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    school_id           UUID NOT NULL,
    attendance_date     DATE NOT NULL,
    total_registered    INTEGER NOT NULL,
    total_present       INTEGER NOT NULL,
    total_absent        INTEGER NOT NULL,
    version             INTEGER NOT NULL DEFAULT 1,
    updated_by          UUID,
    client_id           TEXT,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT attendance_school_fk
        FOREIGN KEY (school_id) REFERENCES schools (id)
        ON UPDATE CASCADE
        ON DELETE RESTRICT,
    CONSTRAINT attendance_updated_by_fk
        FOREIGN KEY (updated_by) REFERENCES users (id)
        ON UPDATE CASCADE
        ON DELETE SET NULL,
    CONSTRAINT attendance_school_date_unique UNIQUE (school_id, attendance_date),
    CONSTRAINT attendance_registered_nonneg CHECK (total_registered >= 0),
    CONSTRAINT attendance_present_nonneg CHECK (total_present >= 0),
    CONSTRAINT attendance_absent_nonneg CHECK (total_absent >= 0),
    CONSTRAINT attendance_present_absent_within_registered
        CHECK (total_present + total_absent <= total_registered),
    CONSTRAINT attendance_version_nonneg CHECK (version >= 0)
);

-- ---------------------------------------------------------------------------
-- Meal distribution (daily school-level counts)
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS meal_distributions (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    school_id           UUID NOT NULL,
    distribution_date   DATE NOT NULL,
    meals_prepared      INTEGER NOT NULL,
    meals_served        INTEGER NOT NULL,
    version             INTEGER NOT NULL DEFAULT 1,
    updated_by          UUID,
    client_id           TEXT,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT meals_school_fk
        FOREIGN KEY (school_id) REFERENCES schools (id)
        ON UPDATE CASCADE
        ON DELETE RESTRICT,
    CONSTRAINT meals_updated_by_fk
        FOREIGN KEY (updated_by) REFERENCES users (id)
        ON UPDATE CASCADE
        ON DELETE SET NULL,
    CONSTRAINT meals_school_date_unique UNIQUE (school_id, distribution_date),
    CONSTRAINT meals_prepared_nonneg CHECK (meals_prepared >= 0),
    CONSTRAINT meals_served_nonneg CHECK (meals_served >= 0),
    CONSTRAINT meals_served_not_above_prepared
        CHECK (meals_served <= meals_prepared),
    CONSTRAINT meals_version_nonneg CHECK (version >= 0)
);

-- ---------------------------------------------------------------------------
-- Synchronization operations (processing implemented in a later phase)
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS sync_operations (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    operation_id    TEXT NOT NULL,
    entity_type     TEXT NOT NULL,
    record_id       UUID NOT NULL,
    operation_type  TEXT NOT NULL,
    payload         JSONB,
    client_id       TEXT NOT NULL,
    base_version    INTEGER,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    processed_at    TIMESTAMPTZ,
    status          TEXT NOT NULL DEFAULT 'pending',
    CONSTRAINT sync_operations_operation_id_unique UNIQUE (operation_id),
    CONSTRAINT sync_operations_entity_type_check
        CHECK (entity_type IN ('attendance', 'meal_distribution')),
    CONSTRAINT sync_operations_operation_type_check
        CHECK (operation_type IN ('CREATE', 'UPDATE', 'DELETE')),
    CONSTRAINT sync_operations_status_check
        CHECK (status IN ('pending', 'applied', 'conflict', 'failed')),
    CONSTRAINT sync_operations_base_version_nonneg
        CHECK (base_version IS NULL OR base_version >= 0)
);

-- ---------------------------------------------------------------------------
-- Conflicts (resolution UI/logic implemented in a later phase)
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS conflicts (
    conflict_id     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    entity_type     TEXT NOT NULL,
    record_id       UUID NOT NULL,
    operation_id    TEXT NOT NULL,
    client_id       TEXT NOT NULL,
    base_version    INTEGER,
    server_version  INTEGER,
    local_payload   JSONB,
    server_payload  JSONB,
    status          TEXT NOT NULL DEFAULT 'unresolved',
    resolution      TEXT,
    resolved_by     UUID,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    resolved_at     TIMESTAMPTZ,
    CONSTRAINT conflicts_operation_fk
        FOREIGN KEY (operation_id) REFERENCES sync_operations (operation_id)
        ON UPDATE CASCADE
        ON DELETE RESTRICT,
    CONSTRAINT conflicts_resolved_by_fk
        FOREIGN KEY (resolved_by) REFERENCES users (id)
        ON UPDATE CASCADE
        ON DELETE SET NULL,
    CONSTRAINT conflicts_entity_type_check
        CHECK (entity_type IN ('attendance', 'meal_distribution')),
    CONSTRAINT conflicts_status_check
        CHECK (status IN ('unresolved', 'resolved')),
    CONSTRAINT conflicts_base_version_nonneg
        CHECK (base_version IS NULL OR base_version >= 0),
    CONSTRAINT conflicts_server_version_nonneg
        CHECK (server_version IS NULL OR server_version >= 0)
);

-- ---------------------------------------------------------------------------
-- Forecast results (written later by Flask/Prophet; no model code here)
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS forecast_results (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    school_id           UUID NOT NULL,
    forecast_date       DATE NOT NULL,
    predicted_meals     NUMERIC(10, 2) NOT NULL,
    lower_bound         NUMERIC(10, 2),
    upper_bound         NUMERIC(10, 2),
    model_name          TEXT NOT NULL DEFAULT 'prophet',
    generated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT forecast_school_fk
        FOREIGN KEY (school_id) REFERENCES schools (id)
        ON UPDATE CASCADE
        ON DELETE RESTRICT,
    CONSTRAINT forecast_predicted_nonneg CHECK (predicted_meals >= 0),
    CONSTRAINT forecast_lower_nonneg CHECK (lower_bound IS NULL OR lower_bound >= 0),
    CONSTRAINT forecast_upper_nonneg CHECK (upper_bound IS NULL OR upper_bound >= 0),
    CONSTRAINT forecast_bounds_order
        CHECK (
            lower_bound IS NULL
            OR upper_bound IS NULL
            OR lower_bound <= upper_bound
        )
);

-- ---------------------------------------------------------------------------
-- Indexes
-- ---------------------------------------------------------------------------

CREATE INDEX IF NOT EXISTS idx_attendance_school_date
    ON attendance_records (school_id, attendance_date);

CREATE INDEX IF NOT EXISTS idx_attendance_version
    ON attendance_records (version);

CREATE INDEX IF NOT EXISTS idx_meals_school_date
    ON meal_distributions (school_id, distribution_date);

CREATE INDEX IF NOT EXISTS idx_meals_version
    ON meal_distributions (version);

CREATE INDEX IF NOT EXISTS idx_sync_ops_status
    ON sync_operations (status);

CREATE INDEX IF NOT EXISTS idx_conflicts_status
    ON conflicts (status);

CREATE INDEX IF NOT EXISTS idx_forecast_date
    ON forecast_results (forecast_date);

CREATE INDEX IF NOT EXISTS idx_users_role
    ON users (role);
