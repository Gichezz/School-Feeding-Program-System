-- Migration 007: authenticator app codes (TOTP) for administrators (#63).
-- Adds totp_credentials. New databases get it from schema.sql and do not need this script.
--
-- Run with: psql -U postgres -d <database> -f database/migrations/007_admin_totp.sql

BEGIN;

-- Authenticator app codes (TOTP) for administrators (#63)
-- One row per administrator. The secret is encrypted by the API (AES-256-GCM) and
-- never returned after set-up; confirmed_at is empty until the first code is checked.

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

COMMIT;
