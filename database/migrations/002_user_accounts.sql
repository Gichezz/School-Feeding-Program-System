-- Migration 002: user account management (#51).
-- Adds the active flag and the password-change time used to end old sessions.
-- New databases get these columns from schema.sql and do not need this script.
--
-- Run with: psql -U postgres -d <database> -f database/migrations/002_user_accounts.sql

BEGIN;

ALTER TABLE users
    ADD COLUMN IF NOT EXISTS is_active BOOLEAN NOT NULL DEFAULT TRUE;

ALTER TABLE users
    ADD COLUMN IF NOT EXISTS password_changed_at TIMESTAMPTZ;

COMMIT;
