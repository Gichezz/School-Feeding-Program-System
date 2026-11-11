-- Migration 020: enrolment discrepancies and reasons for changes.
-- A programme officer who finds a school's enrolment does not match the admission
-- register records a discrepancy with a note, which the school's devices download and
-- show on the Enrolment page. Changing a class that was verified needs a reason
-- (a new admission, a transfer, or a correction), kept in the record's history.
-- verified_learners keeps the last verified number, so the term plan uses it until the
-- officer checks the new one.
-- (019 is reserved for the emailed activation codes.)
-- New databases get this from schema.sql and do not need this script.
--
-- Run with: psql -U postgres -d <database> -f database/migrations/020_enrolment_discrepancy.sql

BEGIN;

ALTER TABLE enrolment ADD COLUMN IF NOT EXISTS verified_learners INTEGER;
ALTER TABLE enrolment ADD COLUMN IF NOT EXISTS change_reason TEXT;
ALTER TABLE enrolment ADD COLUMN IF NOT EXISTS discrepancy_note TEXT;
ALTER TABLE enrolment ADD COLUMN IF NOT EXISTS discrepancy_by UUID;
ALTER TABLE enrolment ADD COLUMN IF NOT EXISTS discrepancy_at TIMESTAMPTZ;

ALTER TABLE enrolment DROP CONSTRAINT IF EXISTS enrolment_verified_learners_nonneg;
ALTER TABLE enrolment ADD CONSTRAINT enrolment_verified_learners_nonneg CHECK (verified_learners >= 0);
ALTER TABLE enrolment DROP CONSTRAINT IF EXISTS enrolment_change_reason_check;
ALTER TABLE enrolment ADD CONSTRAINT enrolment_change_reason_check
    CHECK (change_reason IN ('admission', 'transfer', 'correction'));
ALTER TABLE enrolment DROP CONSTRAINT IF EXISTS enrolment_discrepancy_note_length;
ALTER TABLE enrolment ADD CONSTRAINT enrolment_discrepancy_note_length
    CHECK (char_length(discrepancy_note) BETWEEN 1 AND 500);
ALTER TABLE enrolment DROP CONSTRAINT IF EXISTS enrolment_discrepancy_by_fk;
ALTER TABLE enrolment ADD CONSTRAINT enrolment_discrepancy_by_fk FOREIGN KEY (discrepancy_by) REFERENCES users (id)
    ON UPDATE CASCADE ON DELETE SET NULL;

-- Classes verified before this migration: their verified number is the current one
UPDATE enrolment SET verified_learners = learners WHERE verified_at IS NOT NULL AND verified_learners IS NULL;

COMMIT;
