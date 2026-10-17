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
    -- School staff belong to one school (foreign key added after the schools table);
    -- administrators have none and can see every school
    school_id       UUID,
    -- Deactivated users cannot sign in and their sessions stop working
    is_active       BOOLEAN NOT NULL DEFAULT TRUE,
    -- Sessions issued before this time are rejected (set on password change or reset)
    password_changed_at TIMESTAMPTZ,
    -- When an administrator last reset the password; records captured before it are
    -- held for review rather than applied (#61)
    password_reset_at TIMESTAMPTZ,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT users_email_unique UNIQUE (email),
    CONSTRAINT users_email_format CHECK (
        email ~* '^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$'
    ),
    CONSTRAINT users_role_check CHECK (role IN ('admin', 'school_staff')),
    CONSTRAINT users_password_hash_present CHECK (char_length(password_hash) >= 20),
    CONSTRAINT users_staff_school CHECK (role <> 'school_staff' OR school_id IS NOT NULL)
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
    -- Who captured it, on which school device, when on the device, and when it reached
    -- the server (#62). Empty for records saved before these were tracked.
    captured_by         UUID,
    device_id           UUID,
    captured_at         TIMESTAMPTZ,
    received_at         TIMESTAMPTZ,
    -- Why a record for an older date was entered late
    late_reason         TEXT,
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
    -- Every registered learner is counted as either present or absent
    CONSTRAINT attendance_present_absent_equals_registered
        CHECK (total_present + total_absent = total_registered),
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
    -- Who captured it, on which school device, when on the device, and when it reached
    -- the server (#62). Empty for records saved before these were tracked.
    captured_by         UUID,
    device_id           UUID,
    captured_at         TIMESTAMPTZ,
    received_at         TIMESTAMPTZ,
    -- Why a record for an older date was entered late
    late_reason         TEXT,
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
    -- Who captured the record, on which school device and when (#61)
    captured_by     UUID,
    device_id       UUID,
    captured_at     TIMESTAMPTZ,
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
-- Passkeys (WebAuthn) for administrators (#57)
-- Only the public key is stored; the private key never leaves the user's device.
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS passkey_credentials (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id         UUID NOT NULL,
    -- base64url credential ID chosen by the authenticator
    credential_id   TEXT NOT NULL,
    public_key      BYTEA NOT NULL,
    -- signature counter reported by the authenticator (0 when it does not count)
    counter         BIGINT NOT NULL DEFAULT 0,
    transports      TEXT[] NOT NULL DEFAULT '{}',
    name            TEXT NOT NULL,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    last_used_at    TIMESTAMPTZ,
    CONSTRAINT passkey_credential_id_unique UNIQUE (credential_id),
    CONSTRAINT passkey_user_fk
        FOREIGN KEY (user_id) REFERENCES users (id)
        ON UPDATE CASCADE
        ON DELETE CASCADE,
    CONSTRAINT passkey_counter_nonneg CHECK (counter >= 0)
);

-- One-time WebAuthn challenges; each is deleted when used and expires after a few minutes
CREATE TABLE IF NOT EXISTS auth_challenges (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    challenge       TEXT NOT NULL,
    purpose         TEXT NOT NULL,
    -- set for registration (the signed-in user); empty for sign-in
    user_id         UUID,
    expires_at      TIMESTAMPTZ NOT NULL,
    CONSTRAINT auth_challenge_unique UNIQUE (challenge),
    CONSTRAINT auth_challenge_purpose_check CHECK (purpose IN ('register', 'authenticate', 'device')),
    CONSTRAINT auth_challenge_user_fk
        FOREIGN KEY (user_id) REFERENCES users (id)
        ON UPDATE CASCADE
        ON DELETE CASCADE
);

-- One-time recovery codes, stored only as bcrypt hashes
CREATE TABLE IF NOT EXISTS recovery_codes (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id         UUID NOT NULL,
    code_hash       TEXT NOT NULL,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    used_at         TIMESTAMPTZ,
    CONSTRAINT recovery_code_user_fk
        FOREIGN KEY (user_id) REFERENCES users (id)
        ON UPDATE CASCADE
        ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_passkey_user
    ON passkey_credentials (user_id);

CREATE INDEX IF NOT EXISTS idx_recovery_codes_user
    ON recovery_codes (user_id);

-- ---------------------------------------------------------------------------
-- Authenticator app codes (TOTP) for administrators (#63)
-- One row per administrator. The secret is encrypted by the API (AES-256-GCM) and
-- never returned after set-up; confirmed_at is empty until the first code is checked.
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS totp_credentials (
    user_id             UUID PRIMARY KEY,
    secret_encrypted    TEXT NOT NULL,
    confirmed_at        TIMESTAMPTZ,
    -- the 30-second step of the last accepted code; a code is never accepted twice
    last_used_step      BIGINT,
    failed_attempts     INTEGER NOT NULL DEFAULT 0,
    locked_until        TIMESTAMPTZ,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT totp_user_fk
        FOREIGN KEY (user_id) REFERENCES users (id)
        ON UPDATE CASCADE
        ON DELETE CASCADE,
    CONSTRAINT totp_failed_nonneg CHECK (failed_attempts >= 0)
);

-- ---------------------------------------------------------------------------
-- School devices and staff PINs (#60)
-- Staff record on designated school devices. Each device holds a private key that
-- never leaves it; the server keeps the public key. An administrator approves each
-- device before staff can sign in on it.
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS devices (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    school_id       UUID NOT NULL,
    name            TEXT NOT NULL,
    status          TEXT NOT NULL DEFAULT 'pending',
    -- P-256 public key (JWK) of the device's non-exportable key pair
    public_key      JSONB NOT NULL,
    enrolled_by     UUID,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    approved_by     UUID,
    approved_at     TIMESTAMPTZ,
    revoked_by      UUID,
    revoked_at      TIMESTAMPTZ,
    last_seen_at    TIMESTAMPTZ,
    CONSTRAINT devices_status_check CHECK (status IN ('pending', 'approved', 'revoked')),
    CONSTRAINT devices_school_fk
        FOREIGN KEY (school_id) REFERENCES schools (id)
        ON UPDATE CASCADE
        ON DELETE RESTRICT,
    CONSTRAINT devices_enrolled_by_fk
        FOREIGN KEY (enrolled_by) REFERENCES users (id)
        ON UPDATE CASCADE
        ON DELETE SET NULL,
    CONSTRAINT devices_approved_by_fk
        FOREIGN KEY (approved_by) REFERENCES users (id)
        ON UPDATE CASCADE
        ON DELETE SET NULL,
    CONSTRAINT devices_revoked_by_fk
        FOREIGN KEY (revoked_by) REFERENCES users (id)
        ON UPDATE CASCADE
        ON DELETE SET NULL
);

-- A staff member's PIN on one device (stored only as a bcrypt hash)
CREATE TABLE IF NOT EXISTS device_users (
    device_id       UUID NOT NULL,
    user_id         UUID NOT NULL,
    pin_hash        TEXT NOT NULL,
    failed_attempts INTEGER NOT NULL DEFAULT 0,
    -- set after too many wrong PINs; an administrator unlocks it
    locked_at       TIMESTAMPTZ,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    last_sign_in_at TIMESTAMPTZ,
    PRIMARY KEY (device_id, user_id),
    CONSTRAINT device_users_device_fk
        FOREIGN KEY (device_id) REFERENCES devices (id)
        ON UPDATE CASCADE
        ON DELETE CASCADE,
    CONSTRAINT device_users_user_fk
        FOREIGN KEY (user_id) REFERENCES users (id)
        ON UPDATE CASCADE
        ON DELETE CASCADE,
    CONSTRAINT device_users_failed_nonneg CHECK (failed_attempts >= 0)
);

-- One-time codes an administrator gives a new staff member to set up their account
CREATE TABLE IF NOT EXISTS activation_codes (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id         UUID NOT NULL,
    code_hash       TEXT NOT NULL,
    created_by      UUID,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    expires_at      TIMESTAMPTZ NOT NULL,
    used_at         TIMESTAMPTZ,
    CONSTRAINT activation_codes_user_fk
        FOREIGN KEY (user_id) REFERENCES users (id)
        ON UPDATE CASCADE
        ON DELETE CASCADE,
    CONSTRAINT activation_codes_created_by_fk
        FOREIGN KEY (created_by) REFERENCES users (id)
        ON UPDATE CASCADE
        ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_devices_school
    ON devices (school_id);

CREATE INDEX IF NOT EXISTS idx_device_users_user
    ON device_users (user_id);

CREATE INDEX IF NOT EXISTS idx_activation_codes_user
    ON activation_codes (user_id);

-- users.school_id refers to schools, which is created after users
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'users_school_fk') THEN
        ALTER TABLE users
            ADD CONSTRAINT users_school_fk
            FOREIGN KEY (school_id) REFERENCES schools (id)
            ON UPDATE CASCADE
            ON DELETE RESTRICT;
    END IF;
END $$;

-- ---------------------------------------------------------------------------
-- Held records (#61)
-- Records captured on a device that the server will not apply automatically: the
-- person who captured them was deactivated or had their password reset afterwards, or
-- the device was removed. An administrator reviews each one and applies or discards it.
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS held_operations (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    operation_id    TEXT NOT NULL,
    entity_type     TEXT NOT NULL,
    operation_type  TEXT NOT NULL,
    payload         JSONB NOT NULL,
    base_version    INTEGER NOT NULL DEFAULT 0,
    client_id       TEXT NOT NULL,
    captured_by     UUID,
    device_id       UUID,
    captured_at     TIMESTAMPTZ,
    -- the signed-in user whose sync handed the record in
    submitted_by    UUID,
    reason          TEXT NOT NULL,
    status          TEXT NOT NULL DEFAULT 'pending',
    reviewed_by     UUID,
    reviewed_at     TIMESTAMPTZ,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT held_operations_operation_unique UNIQUE (operation_id),
    CONSTRAINT held_operations_entity_type_check CHECK (entity_type IN ('attendance', 'meal_distribution')),
    CONSTRAINT held_operations_operation_type_check CHECK (operation_type IN ('create', 'update')),
    CONSTRAINT held_operations_reason_check CHECK (reason IN ('user_deactivated', 'password_reset', 'device_revoked')),
    CONSTRAINT held_operations_status_check CHECK (status IN ('pending', 'applied', 'discarded')),
    CONSTRAINT held_operations_captured_by_fk
        FOREIGN KEY (captured_by) REFERENCES users (id)
        ON UPDATE CASCADE
        ON DELETE SET NULL,
    CONSTRAINT held_operations_submitted_by_fk
        FOREIGN KEY (submitted_by) REFERENCES users (id)
        ON UPDATE CASCADE
        ON DELETE SET NULL,
    CONSTRAINT held_operations_reviewed_by_fk
        FOREIGN KEY (reviewed_by) REFERENCES users (id)
        ON UPDATE CASCADE
        ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_held_operations_status
    ON held_operations (status);

-- ---------------------------------------------------------------------------
-- Record history and review flags (#62)
-- Every saved version of an attendance or meal record, and records flagged for an
-- administrator to check (flags never block a record).
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS record_history (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    entity_type     TEXT NOT NULL,
    record_id       UUID NOT NULL,
    version         INTEGER NOT NULL,
    -- the counts and date as saved in this version
    values          JSONB NOT NULL,
    changed_by      UUID,
    device_id       UUID,
    captured_at     TIMESTAMPTZ,
    changed_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT record_history_entity_type_check CHECK (entity_type IN ('attendance', 'meal_distribution')),
    CONSTRAINT record_history_changed_by_fk
        FOREIGN KEY (changed_by) REFERENCES users (id)
        ON UPDATE CASCADE
        ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS record_flags (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    entity_type     TEXT NOT NULL,
    record_id       UUID NOT NULL,
    version         INTEGER NOT NULL,
    flag            TEXT NOT NULL,
    detail          TEXT NOT NULL,
    status          TEXT NOT NULL DEFAULT 'open',
    note            TEXT,
    checked_by      UUID,
    checked_at      TIMESTAMPTZ,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT record_flags_unique UNIQUE (entity_type, record_id, version, flag),
    CONSTRAINT record_flags_entity_type_check CHECK (entity_type IN ('attendance', 'meal_distribution')),
    CONSTRAINT record_flags_flag_check CHECK (flag IN ('outside_hours', 'entered_late', 'synced_late', 'served_exceeds_present', 'unusual_numbers')),
    CONSTRAINT record_flags_status_check CHECK (status IN ('open', 'checked')),
    CONSTRAINT record_flags_checked_by_fk
        FOREIGN KEY (checked_by) REFERENCES users (id)
        ON UPDATE CASCADE
        ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_record_history_record
    ON record_history (entity_type, record_id);

CREATE INDEX IF NOT EXISTS idx_record_flags_status
    ON record_flags (status);

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
