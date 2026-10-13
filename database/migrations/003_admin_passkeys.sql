-- Migration 003: passkey sign-in for administrators (#57).
-- Adds passkey credentials, one-time sign-in challenges and recovery codes.
-- New databases get these tables from schema.sql and do not need this script.
--
-- Run with: psql -U postgres -d <database> -f database/migrations/003_admin_passkeys.sql

BEGIN;

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
    CONSTRAINT auth_challenge_purpose_check CHECK (purpose IN ('register', 'authenticate')),
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

COMMIT;
