-- Migration 001: every registered learner is counted as either present or absent.
-- Replaces the old rule (present + absent <= registered) with
-- present + absent = registered on an existing database.
-- New databases get this constraint from schema.sql and do not need this script.
--
-- Run with: psql -U postgres -d <database> -f database/migrations/001_attendance_present_absent_equals_registered.sql

BEGIN;

ALTER TABLE attendance_records
    DROP CONSTRAINT IF EXISTS attendance_present_absent_within_registered;

-- NOT VALID: enforced for every new or updated row, without failing on existing rows
-- that do not add up. Fix those rows, then validate (see below).
ALTER TABLE attendance_records
    DROP CONSTRAINT IF EXISTS attendance_present_absent_equals_registered;
ALTER TABLE attendance_records
    ADD CONSTRAINT attendance_present_absent_equals_registered
    CHECK (total_present + total_absent = total_registered) NOT VALID;

COMMIT;

-- Existing records that do not add up (correct these before validating):
SELECT id, school_id, attendance_date, total_registered, total_present, total_absent
FROM attendance_records
WHERE total_present + total_absent <> total_registered
ORDER BY attendance_date;

-- Once the query above returns no rows, check all existing rows as well:
--   ALTER TABLE attendance_records VALIDATE CONSTRAINT attendance_present_absent_equals_registered;
