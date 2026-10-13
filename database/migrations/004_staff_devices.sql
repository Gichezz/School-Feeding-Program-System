-- Migration 004: staff activation and school device enrolment (#60).
-- Adds the school of each staff member, school devices, staff PINs per device and
-- one-time activation codes.
-- New databases get these from schema.sql and do not need this script.
--
-- Run with: psql -U postgres -d <database> -f database/migrations/004_staff_devices.sql

BEGIN;

ALTER TABLE users ADD COLUMN IF NOT EXISTS school_id UUID;

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

-- With a single school (the prototype), existing staff belong to it
UPDATE users
SET school_id = (SELECT id FROM schools LIMIT 1)
WHERE role = 'school_staff'
  AND school_id IS NULL
  AND (SELECT count(*) FROM schools) = 1;

-- NOT VALID: applies to new and changed rows without failing on staff who still need a
-- school. Assign one from Settings → Users, then run:
--   ALTER TABLE users VALIDATE CONSTRAINT users_staff_school;
ALTER TABLE users DROP CONSTRAINT IF EXISTS users_staff_school;
ALTER TABLE users
    ADD CONSTRAINT users_staff_school CHECK (role <> 'school_staff' OR school_id IS NOT NULL) NOT VALID;

-- Device sign-in uses one-time challenges too
ALTER TABLE auth_challenges DROP CONSTRAINT IF EXISTS auth_challenge_purpose_check;
ALTER TABLE auth_challenges
    ADD CONSTRAINT auth_challenge_purpose_check CHECK (purpose IN ('register', 'authenticate', 'device'));

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

COMMIT;
