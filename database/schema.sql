-- School Feeding System — PostgreSQL schema (Phase 2)
-- Authoritative central store for one-school prototype, extensible to more schools.
-- Synchronization, conflict resolution, the stock ledger and weekly review lists.
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
    -- Programme officers oversee every school in their sub-county
    sub_county      TEXT,
    -- Deactivated users cannot sign in and their sessions stop working
    is_active       BOOLEAN NOT NULL DEFAULT TRUE,
    -- Set when an activation code that was emailed to this address is used: the address
    -- is real and theirs (migration 019)
    email_verified_at TIMESTAMPTZ,
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
    CONSTRAINT users_role_check CHECK (role IN ('admin', 'programme_officer', 'school_staff')),
    CONSTRAINT users_password_hash_present CHECK (char_length(password_hash) >= 20),
    CONSTRAINT users_staff_school CHECK (role <> 'school_staff' OR school_id IS NOT NULL),
    CONSTRAINT users_officer_sub_county CHECK (role <> 'programme_officer' OR sub_county IS NOT NULL)
);

-- ---------------------------------------------------------------------------
-- Schools
-- Prototype uses one selected school; school_id on child tables allows more later.
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS schools (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name            TEXT NOT NULL,
    location        TEXT,
    county          TEXT,
    sub_county      TEXT,
    -- food delivered in kind, or a cash transfer the school buys food with
    programme_type  TEXT NOT NULL DEFAULT 'in_kind',
    -- grams per learner per day; the School Meals Programme ration by default
    ration_cereals_g NUMERIC(6, 1) NOT NULL DEFAULT 150,
    ration_pulses_g NUMERIC(6, 1) NOT NULL DEFAULT 40,
    ration_oil_g    NUMERIC(6, 1) NOT NULL DEFAULT 5,
    ration_salt_g   NUMERIC(6, 1) NOT NULL DEFAULT 2,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT schools_programme_type_check CHECK (programme_type IN ('in_kind', 'cash_transfer')),
    CONSTRAINT schools_ration_positive
        CHECK (ration_cereals_g > 0 AND ration_pulses_g > 0 AND ration_oil_g >= 0 AND ration_salt_g >= 0)
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
        CHECK (entity_type IN ('attendance', 'meal_distribution', 'enrolment', 'daily_feeding', 'stock_movement', 'stock_count')),
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
        CHECK (entity_type IN ('attendance', 'meal_distribution', 'enrolment', 'daily_feeding')),
    CONSTRAINT conflicts_status_check
        CHECK (status IN ('unresolved', 'resolved')),
    CONSTRAINT conflicts_base_version_nonneg
        CHECK (base_version IS NULL OR base_version >= 0),
    CONSTRAINT conflicts_server_version_nonneg
        CHECK (server_version IS NULL OR server_version >= 0)
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
    -- sent to the user's email address rather than handed over (migration 019)
    emailed         BOOLEAN NOT NULL DEFAULT false,
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
    -- the transaction that applied or discarded it, so devices download the decision
    decided_xid     XID8,
    CONSTRAINT held_operations_operation_unique UNIQUE (operation_id),
    CONSTRAINT held_operations_entity_type_check CHECK (entity_type IN ('attendance', 'meal_distribution', 'enrolment', 'daily_feeding', 'stock_movement', 'stock_count')),
    CONSTRAINT held_operations_operation_type_check CHECK (operation_type IN ('create', 'update')),
    CONSTRAINT held_operations_reason_check CHECK (reason IN ('user_deactivated', 'password_reset', 'device_revoked', 'duplicate_delivery')),
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
    CONSTRAINT record_history_entity_type_check CHECK (entity_type IN ('attendance', 'meal_distribution', 'enrolment', 'daily_feeding')),
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
    CONSTRAINT record_flags_entity_type_check CHECK (entity_type IN ('attendance', 'meal_distribution', 'enrolment', 'daily_feeding', 'stock_movement', 'stock_count')),
    CONSTRAINT record_flags_flag_check CHECK (flag IN ('outside_hours', 'entered_late', 'synced_late', 'served_exceeds_present',
                                                       'unusual_numbers', 'fed_exceeds_enrolled', 'fed_exceeds_present',
                                                       'issue_exceeds_stock', 'usage_far_from_ration', 'delivery_short')),
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

CREATE INDEX IF NOT EXISTS idx_users_role
    ON users (role);


-- ---------------------------------------------------------------------------
-- School calendar (migration 009)
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS school_terms (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    year            SMALLINT NOT NULL,
    -- 1, 2 or 3; empty for a practice term
    term            SMALLINT,
    opens_on        DATE NOT NULL,
    closes_on       DATE NOT NULL,
    -- the days learners are away for half-term, if the term has one
    half_term_start DATE,
    half_term_end   DATE,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    -- A practice term (migration 016): a labelled period outside the national calendar,
    -- for example for a demonstration while schools are on holiday
    label           TEXT,
    practice        BOOLEAN NOT NULL DEFAULT false,
    CONSTRAINT school_terms_unique UNIQUE (year, term),
    CONSTRAINT school_terms_term_check CHECK (term BETWEEN 1 AND 3),
    CONSTRAINT school_terms_dates_order CHECK (closes_on > opens_on),
    CONSTRAINT school_terms_half_term CHECK (
        (half_term_start IS NULL AND half_term_end IS NULL)
        OR (half_term_start > opens_on AND half_term_end >= half_term_start AND half_term_end < closes_on)
    ),
    CONSTRAINT school_terms_practice CHECK (
        (practice AND term IS NULL AND label IS NOT NULL AND btrim(label) <> '')
        OR (NOT practice AND term IS NOT NULL))
);

CREATE TABLE IF NOT EXISTS calendar_events (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    -- empty for national dates that apply to every school
    school_id       UUID,
    starts_on       DATE NOT NULL,
    ends_on         DATE NOT NULL,
    kind            TEXT NOT NULL,
    name            TEXT NOT NULL,
    created_by      UUID,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT calendar_events_kind_check
        CHECK (kind IN ('public_holiday', 'national_exam', 'school_closure', 'school_event')),
    CONSTRAINT calendar_events_dates_order CHECK (ends_on >= starts_on),
    -- closures and events belong to one school; holidays and exams are national
    CONSTRAINT calendar_events_scope CHECK (
        (kind IN ('public_holiday', 'national_exam') AND school_id IS NULL)
        OR (kind IN ('school_closure', 'school_event') AND school_id IS NOT NULL)
    ),
    CONSTRAINT calendar_events_school_fk
        FOREIGN KEY (school_id) REFERENCES schools (id)
        ON UPDATE CASCADE
        ON DELETE CASCADE,
    CONSTRAINT calendar_events_created_by_fk
        FOREIGN KEY (created_by) REFERENCES users (id)
        ON UPDATE CASCADE
        ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_calendar_events_dates ON calendar_events (starts_on, ends_on);
CREATE INDEX IF NOT EXISTS idx_calendar_events_school ON calendar_events (school_id);

-- ---------------------------------------------------------------------------
-- Sync batches, change tracking and append-only guard (migration 010)
-- ---------------------------------------------------------------------------

-- Stamps the row with the transaction that wrote it, on every insert and update
CREATE OR REPLACE FUNCTION set_change_xid() RETURNS trigger AS $$
BEGIN
    NEW.change_xid := pg_current_xact_id();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- For append-only tables: entries are corrected by a reversing entry, never changed
CREATE OR REPLACE FUNCTION refuse_change() RETURNS trigger AS $$
BEGIN
    RAISE EXCEPTION '% is append-only: add a correcting entry instead', TG_TABLE_NAME
        USING ERRCODE = 'restrict_violation';
END;
$$ LANGUAGE plpgsql;

CREATE TABLE IF NOT EXISTS sync_batches (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    school_id       UUID,
    device_id       UUID,
    user_id         UUID,
    operation_count INTEGER NOT NULL DEFAULT 0,
    received_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT sync_batches_school_fk
        FOREIGN KEY (school_id) REFERENCES schools (id)
        ON UPDATE CASCADE
        ON DELETE SET NULL,
    CONSTRAINT sync_batches_device_fk
        FOREIGN KEY (device_id) REFERENCES devices (id)
        ON UPDATE CASCADE
        ON DELETE SET NULL,
    CONSTRAINT sync_batches_user_fk
        FOREIGN KEY (user_id) REFERENCES users (id)
        ON UPDATE CASCADE
        ON DELETE SET NULL,
    CONSTRAINT sync_batches_count_nonneg CHECK (operation_count >= 0)
);

ALTER TABLE sync_operations ADD COLUMN IF NOT EXISTS sync_batch_id UUID;

-- Conflicts belong to the school of the record they are about; resolved_xid is the
-- transaction that resolved one, so devices at the school download the decision
ALTER TABLE conflicts ADD COLUMN IF NOT EXISTS school_id UUID;
ALTER TABLE conflicts ADD COLUMN IF NOT EXISTS resolved_xid XID8;
CREATE INDEX IF NOT EXISTS idx_conflicts_school ON conflicts (school_id, status);
CREATE INDEX IF NOT EXISTS idx_conflicts_resolved_xid ON conflicts (resolved_xid);

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'sync_operations_batch_fk') THEN
        ALTER TABLE sync_operations
            ADD CONSTRAINT sync_operations_batch_fk
            FOREIGN KEY (sync_batch_id) REFERENCES sync_batches (id)
            ON UPDATE CASCADE
            ON DELETE SET NULL;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'conflicts_school_fk') THEN
        ALTER TABLE conflicts
            ADD CONSTRAINT conflicts_school_fk
            FOREIGN KEY (school_id) REFERENCES schools (id)
            ON UPDATE CASCADE
            ON DELETE SET NULL;
    END IF;
END $$;

-- ---------------------------------------------------------------------------
-- Termly enrolment and the daily feeding record (migration 011)
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS enrolment (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    school_id       UUID NOT NULL,
    term_id         UUID NOT NULL,
    class           TEXT NOT NULL,
    sex             CHAR(1) NOT NULL,
    learners        INTEGER NOT NULL,
    verified_by     UUID,
    verified_at     TIMESTAMPTZ,
    captured_by     UUID,
    device_id       UUID,
    captured_at     TIMESTAMPTZ,
    received_at     TIMESTAMPTZ,
    sync_batch_id   UUID,
    version         INTEGER NOT NULL DEFAULT 1,
    updated_by      UUID,
    client_id       TEXT,
    change_xid      XID8,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT enrolment_unique UNIQUE (school_id, term_id, class, sex),
    CONSTRAINT enrolment_class_check CHECK (class IN (
        'PP1', 'PP2', 'Grade 1', 'Grade 2', 'Grade 3', 'Grade 4', 'Grade 5', 'Grade 6',
        'Grade 7', 'Grade 8', 'Grade 9')),
    CONSTRAINT enrolment_sex_check CHECK (sex IN ('F', 'M')),
    CONSTRAINT enrolment_learners_nonneg CHECK (learners >= 0),
    CONSTRAINT enrolment_version_positive CHECK (version >= 1),
    CONSTRAINT enrolment_school_fk FOREIGN KEY (school_id) REFERENCES schools (id)
        ON UPDATE CASCADE ON DELETE RESTRICT,
    CONSTRAINT enrolment_term_fk FOREIGN KEY (term_id) REFERENCES school_terms (id)
        ON UPDATE CASCADE ON DELETE RESTRICT,
    CONSTRAINT enrolment_verified_by_fk FOREIGN KEY (verified_by) REFERENCES users (id)
        ON UPDATE CASCADE ON DELETE SET NULL,
    CONSTRAINT enrolment_updated_by_fk FOREIGN KEY (updated_by) REFERENCES users (id)
        ON UPDATE CASCADE ON DELETE SET NULL,
    CONSTRAINT enrolment_batch_fk FOREIGN KEY (sync_batch_id) REFERENCES sync_batches (id)
        ON UPDATE CASCADE ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS daily_feeding (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    school_id           UUID NOT NULL,
    feeding_date        DATE NOT NULL,
    feeding_happened    BOOLEAN NOT NULL,
    learners_present    INTEGER,
    learners_fed        INTEGER NOT NULL DEFAULT 0,
    cereals_kg          NUMERIC(8, 2) NOT NULL DEFAULT 0,
    pulses_kg           NUMERIC(8, 2) NOT NULL DEFAULT 0,
    reason_code         TEXT,
    note                TEXT,
    late_reason         TEXT,
    captured_by         UUID,
    device_id           UUID,
    captured_at         TIMESTAMPTZ,
    received_at         TIMESTAMPTZ,
    sync_batch_id       UUID,
    version             INTEGER NOT NULL DEFAULT 1,
    updated_by          UUID,
    client_id           TEXT,
    change_xid          XID8,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT daily_feeding_unique UNIQUE (school_id, feeding_date),
    CONSTRAINT daily_feeding_counts_nonneg CHECK (
        learners_fed >= 0 AND cereals_kg >= 0 AND pulses_kg >= 0
        AND (learners_present IS NULL OR learners_present >= 0)),
    CONSTRAINT daily_feeding_fed_within_present CHECK (
        learners_present IS NULL OR learners_fed <= learners_present),
    -- No feeding means nothing fed or issued, and a reason
    CONSTRAINT daily_feeding_not_fed CHECK (
        feeding_happened OR (learners_fed = 0 AND cereals_kg = 0 AND pulses_kg = 0 AND reason_code IS NOT NULL)),
    CONSTRAINT daily_feeding_reason_check CHECK (reason_code IS NULL OR reason_code IN (
        -- feeding did not happen
        'no_food', 'school_closed', 'cook_absent', 'no_water_or_fuel', 'learners_sent_home',
        -- feeding happened but the day was unusual
        'half_day', 'school_event', 'exams', 'visitors_fed',
        'other')),
    CONSTRAINT daily_feeding_other_explained CHECK (
        reason_code IS DISTINCT FROM 'other' OR (note IS NOT NULL AND btrim(note) <> '')),
    CONSTRAINT daily_feeding_version_positive CHECK (version >= 1),
    CONSTRAINT daily_feeding_school_fk FOREIGN KEY (school_id) REFERENCES schools (id)
        ON UPDATE CASCADE ON DELETE RESTRICT,
    CONSTRAINT daily_feeding_updated_by_fk FOREIGN KEY (updated_by) REFERENCES users (id)
        ON UPDATE CASCADE ON DELETE SET NULL,
    CONSTRAINT daily_feeding_batch_fk FOREIGN KEY (sync_batch_id) REFERENCES sync_batches (id)
        ON UPDATE CASCADE ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_enrolment_school_term ON enrolment (school_id, term_id);
CREATE INDEX IF NOT EXISTS idx_enrolment_change_xid ON enrolment (change_xid);
CREATE INDEX IF NOT EXISTS idx_daily_feeding_school_date ON daily_feeding (school_id, feeding_date);
CREATE INDEX IF NOT EXISTS idx_daily_feeding_change_xid ON daily_feeding (change_xid);

DROP TRIGGER IF EXISTS enrolment_change_xid ON enrolment;
CREATE TRIGGER enrolment_change_xid BEFORE INSERT OR UPDATE ON enrolment
    FOR EACH ROW EXECUTE FUNCTION set_change_xid();
DROP TRIGGER IF EXISTS daily_feeding_change_xid ON daily_feeding;
CREATE TRIGGER daily_feeding_change_xid BEFORE INSERT OR UPDATE ON daily_feeding
    FOR EACH ROW EXECUTE FUNCTION set_change_xid();

-- ---------------------------------------------------------------------------
-- Stock ledger (migration 012)
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS stock_movements (
    -- generated on the device, so a replayed entry is recognised
    id              UUID PRIMARY KEY,
    school_id       UUID NOT NULL,
    movement_date   DATE NOT NULL,
    commodity       TEXT NOT NULL,
    kind            TEXT NOT NULL,
    quantity_kg     NUMERIC(10, 2) NOT NULL,
    -- what the delivery note or dispatch says was sent, when it differs
    note_quantity_kg NUMERIC(10, 2),
    reference       TEXT,
    supplier        TEXT,
    -- who witnessed a delivery, usually the committee member who signed the note (migration 018)
    witness         TEXT,
    note            TEXT,
    -- set on a reversing entry: the entry it cancels
    reverses_id     UUID,
    -- why an entry for an older date was entered late
    late_reason     TEXT,
    captured_by     UUID,
    device_id       UUID,
    captured_at     TIMESTAMPTZ,
    received_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    sync_batch_id   UUID,
    client_id       TEXT,
    change_xid      XID8,
    CONSTRAINT stock_movements_commodity_check CHECK (commodity IN ('cereals', 'pulses', 'oil', 'salt')),
    -- delivery and purchase add stock; loss and return remove it; reversal undoes an entry
    CONSTRAINT stock_movements_kind_check CHECK (kind IN ('delivery', 'purchase', 'loss', 'return', 'reversal')),
    CONSTRAINT stock_movements_quantity_positive CHECK (quantity_kg > 0),
    CONSTRAINT stock_movements_note_quantity CHECK (note_quantity_kg IS NULL OR note_quantity_kg > 0),
    CONSTRAINT stock_movements_reference_required CHECK (
        kind NOT IN ('delivery', 'purchase') OR (reference IS NOT NULL AND btrim(reference) <> '')),
    CONSTRAINT stock_movements_loss_explained CHECK (
        kind NOT IN ('loss', 'return') OR (note IS NOT NULL AND btrim(note) <> '')),
    CONSTRAINT stock_movements_reversal CHECK ((kind = 'reversal') = (reverses_id IS NOT NULL)),
    -- an entry can be reversed only once
    CONSTRAINT stock_movements_reverses_unique UNIQUE (reverses_id),
    CONSTRAINT stock_movements_school_fk FOREIGN KEY (school_id) REFERENCES schools (id)
        ON UPDATE CASCADE ON DELETE RESTRICT,
    CONSTRAINT stock_movements_reverses_fk FOREIGN KEY (reverses_id) REFERENCES stock_movements (id)
        ON UPDATE RESTRICT ON DELETE RESTRICT,
    CONSTRAINT stock_movements_batch_fk FOREIGN KEY (sync_batch_id) REFERENCES sync_batches (id)
        ON UPDATE CASCADE ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS stock_counts (
    id              UUID PRIMARY KEY,
    school_id       UUID NOT NULL,
    count_date      DATE NOT NULL,
    commodity       TEXT NOT NULL,
    counted_kg      NUMERIC(10, 2) NOT NULL,
    note            TEXT,
    late_reason     TEXT,
    captured_by     UUID,
    device_id       UUID,
    captured_at     TIMESTAMPTZ,
    received_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    sync_batch_id   UUID,
    client_id       TEXT,
    change_xid      XID8,
    CONSTRAINT stock_counts_commodity_check CHECK (commodity IN ('cereals', 'pulses', 'oil', 'salt')),
    CONSTRAINT stock_counts_nonneg CHECK (counted_kg >= 0),
    CONSTRAINT stock_counts_school_fk FOREIGN KEY (school_id) REFERENCES schools (id)
        ON UPDATE CASCADE ON DELETE RESTRICT,
    CONSTRAINT stock_counts_batch_fk FOREIGN KEY (sync_batch_id) REFERENCES sync_batches (id)
        ON UPDATE CASCADE ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_stock_movements_school_date ON stock_movements (school_id, movement_date);
CREATE INDEX IF NOT EXISTS idx_stock_movements_change_xid ON stock_movements (change_xid);
CREATE INDEX IF NOT EXISTS idx_stock_counts_school_date ON stock_counts (school_id, count_date);
CREATE INDEX IF NOT EXISTS idx_stock_counts_change_xid ON stock_counts (change_xid);
CREATE INDEX IF NOT EXISTS idx_stock_movements_delivery_note
    ON stock_movements (school_id, commodity, lower(btrim(reference))) WHERE kind = 'delivery';

DROP TRIGGER IF EXISTS stock_movements_change_xid ON stock_movements;
CREATE TRIGGER stock_movements_change_xid BEFORE INSERT ON stock_movements
    FOR EACH ROW EXECUTE FUNCTION set_change_xid();
DROP TRIGGER IF EXISTS stock_movements_append_only ON stock_movements;
CREATE TRIGGER stock_movements_append_only BEFORE UPDATE OR DELETE ON stock_movements
    FOR EACH ROW EXECUTE FUNCTION refuse_change();
DROP TRIGGER IF EXISTS stock_counts_change_xid ON stock_counts;
CREATE TRIGGER stock_counts_change_xid BEFORE INSERT ON stock_counts
    FOR EACH ROW EXECUTE FUNCTION set_change_xid();
DROP TRIGGER IF EXISTS stock_counts_append_only ON stock_counts;
CREATE TRIGGER stock_counts_append_only BEFORE UPDATE OR DELETE ON stock_counts
    FOR EACH ROW EXECUTE FUNCTION refuse_change();

-- Every flow in and out of a school's store, in kilograms (positive = in).
-- Cereals and pulses issued come from the daily record; oil and salt are derived
-- from the school's ration x learners fed.
CREATE OR REPLACE VIEW stock_flows AS
    SELECT m.school_id, m.movement_date AS flow_date, m.commodity, m.kind AS source,
           CASE m.kind
               WHEN 'delivery' THEN m.quantity_kg
               WHEN 'purchase' THEN m.quantity_kg
               WHEN 'reversal' THEN -(SELECT CASE r.kind WHEN 'delivery' THEN r.quantity_kg
                                                          WHEN 'purchase' THEN r.quantity_kg
                                                          ELSE -r.quantity_kg END
                                     FROM stock_movements r WHERE r.id = m.reverses_id)
               ELSE -m.quantity_kg
           END AS quantity_kg
    FROM stock_movements m
    UNION ALL
    SELECT f.school_id, f.feeding_date, 'cereals', 'issue', -f.cereals_kg FROM daily_feeding f
    UNION ALL
    SELECT f.school_id, f.feeding_date, 'pulses', 'issue', -f.pulses_kg FROM daily_feeding f
    UNION ALL
    SELECT f.school_id, f.feeding_date, 'oil', 'issue', -(f.learners_fed * s.ration_oil_g / 1000.0)
    FROM daily_feeding f JOIN schools s ON s.id = f.school_id
    UNION ALL
    SELECT f.school_id, f.feeding_date, 'salt', 'issue', -(f.learners_fed * s.ration_salt_g / 1000.0)
    FROM daily_feeding f JOIN schools s ON s.id = f.school_id;

CREATE INDEX IF NOT EXISTS idx_schools_sub_county
    ON schools (sub_county);

-- ---------------------------------------------------------------------------
-- Weekly review lists for programme officers (migration 013)
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS review_runs (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    sub_county      TEXT NOT NULL,
    week_start      DATE NOT NULL,
    -- extended_isolation_forest (one_class_svm for runs before migration 015), or
    -- rules_only while a sub-county has little history
    mode            TEXT NOT NULL,
    model           JSONB,
    k               INTEGER NOT NULL,
    rule_breaches   JSONB NOT NULL DEFAULT '[]',
    created_by      UUID,
    -- scored by the API's weekly schedule rather than by an officer (migration 017)
    scored_by_schedule BOOLEAN NOT NULL DEFAULT false,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT review_runs_unique UNIQUE (sub_county, week_start),
    CONSTRAINT review_runs_monday CHECK (EXTRACT(ISODOW FROM week_start) = 1),
    CONSTRAINT review_runs_mode_check CHECK (mode IN ('extended_isolation_forest', 'one_class_svm', 'rules_only', 'no_records')),
    CONSTRAINT review_runs_k_positive CHECK (k > 0),
    CONSTRAINT review_runs_created_by_fk FOREIGN KEY (created_by) REFERENCES users (id)
        ON UPDATE CASCADE ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS review_items (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    run_id          UUID NOT NULL,
    school_id       UUID NOT NULL,
    rank            INTEGER NOT NULL,
    listed          BOOLEAN NOT NULL,
    score           DOUBLE PRECISION NOT NULL,
    top_date        DATE,
    reasons         JSONB NOT NULL DEFAULT '[]',
    explanation     TEXT NOT NULL,
    CONSTRAINT review_items_unique UNIQUE (run_id, school_id),
    CONSTRAINT review_items_rank_positive CHECK (rank > 0),
    CONSTRAINT review_items_run_fk FOREIGN KEY (run_id) REFERENCES review_runs (id)
        ON UPDATE CASCADE ON DELETE CASCADE,
    CONSTRAINT review_items_school_fk FOREIGN KEY (school_id) REFERENCES schools (id)
        ON UPDATE CASCADE ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS review_decisions (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    school_id       UUID NOT NULL,
    week_start      DATE NOT NULL,
    status          TEXT NOT NULL,
    note            TEXT,
    reviewed_by     UUID,
    reviewed_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT review_decisions_unique UNIQUE (school_id, week_start),
    CONSTRAINT review_decisions_status_check CHECK (status IN ('explained', 'follow_up')),
    -- An explanation is what makes "explained" useful to the next officer
    CONSTRAINT review_decisions_note_required CHECK (note IS NOT NULL AND btrim(note) <> ''),
    CONSTRAINT review_decisions_school_fk FOREIGN KEY (school_id) REFERENCES schools (id)
        ON UPDATE CASCADE ON DELETE CASCADE,
    CONSTRAINT review_decisions_reviewed_by_fk FOREIGN KEY (reviewed_by) REFERENCES users (id)
        ON UPDATE CASCADE ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_review_items_run ON review_items (run_id, rank);
CREATE INDEX IF NOT EXISTS idx_review_decisions_week ON review_decisions (week_start);

CREATE INDEX IF NOT EXISTS idx_held_operations_decided_xid ON held_operations (decided_xid);

-- ---------------------------------------------------------------------------
-- Migrations this schema already includes
-- ---------------------------------------------------------------------------
-- The API applies scripts in database/migrations/ that are not listed here when it
-- starts (backend/src/db/migrate.js). A database built from this file has them all.
-- Add each new script here as well as in database/migrations/.

CREATE TABLE IF NOT EXISTS schema_migrations (
    name        TEXT PRIMARY KEY,
    applied_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

INSERT INTO schema_migrations (name) VALUES
    ('001_attendance_present_absent_equals_registered.sql'),
    ('002_user_accounts.sql'),
    ('003_admin_passkeys.sql'),
    ('004_staff_devices.sql'),
    ('005_offline_capture.sql'),
    ('006_record_integrity.sql'),
    ('007_admin_totp.sql'),
    ('008_schools_programme.sql'),
    ('009_calendar.sql'),
    ('010_sync_batches.sql'),
    ('011_enrolment_feeding.sql'),
    ('012_stock_ledger.sql'),
    ('013_review_lists.sql'),
    ('014_held_decisions.sql'),
    ('015_review_model.sql'),
    ('016_practice_terms.sql'),
    ('017_scheduled_review_runs.sql'),
    ('018_delivery_witness.sql'),
    ('019_email_delivery.sql')
ON CONFLICT (name) DO NOTHING;
