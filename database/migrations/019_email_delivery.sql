-- Migration 019: activation codes sent by email, and verified email addresses.
-- When the API can send email, a feeding teacher's activation code is emailed to their
-- address instead of being shown to the administrator, so only the owner of that
-- address can activate the account. activation_codes.emailed marks such a code, and
-- users.email_verified_at is set when one is used: the address is then known to be
-- real and theirs. An administrator who hands a code over in person verifies the
-- person, not the address, so that leaves email_verified_at empty.
-- New databases get this from schema.sql and do not need this script.
--
-- Run with: psql -U postgres -d <database> -f database/migrations/019_email_delivery.sql

BEGIN;

ALTER TABLE activation_codes ADD COLUMN IF NOT EXISTS emailed BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE users ADD COLUMN IF NOT EXISTS email_verified_at TIMESTAMPTZ;

COMMIT;
