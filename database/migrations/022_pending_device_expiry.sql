-- Migration 022: pending device registrations expire.
-- A school device that is set up but not approved within DEVICE_PENDING_DAYS (14 by
-- default, counted from when it was set up) becomes 'expired'. It can no longer be
-- approved, ask whether it is approved, or sign anyone in; the teacher sets the device up
-- again, which is a new registration. The expired one stays, with expired_at, as a
-- record. Approved devices never expire: they are only ever removed (revoked).
-- New databases get this from schema.sql and do not need this script.
--
-- Run with: psql -U postgres -d <database> -f database/migrations/022_pending_device_expiry.sql

BEGIN;

ALTER TABLE devices ADD COLUMN IF NOT EXISTS expired_at TIMESTAMPTZ;
ALTER TABLE devices DROP CONSTRAINT IF EXISTS devices_status_check;
ALTER TABLE devices ADD CONSTRAINT devices_status_check CHECK (status IN ('pending', 'approved', 'revoked', 'expired'));

COMMIT;
