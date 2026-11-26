-- Migration 023: a reason for feeding more learners than enrolled.
-- When more learners are fed than the term's enrolment, the teacher gives a reason:
-- 'new_learners' (joined after the enrolment was recorded) or 'other' with a note.
-- See docs/feeding-record-rules.md.
-- New databases get this from schema.sql and do not need this script.
--
-- Run with: psql -U postgres -d <database> -f database/migrations/023_new_learners_reason.sql

BEGIN;

ALTER TABLE daily_feeding DROP CONSTRAINT IF EXISTS daily_feeding_reason_check;
ALTER TABLE daily_feeding ADD CONSTRAINT daily_feeding_reason_check CHECK (reason_code IS NULL OR reason_code IN (
    -- feeding did not happen
    'no_food', 'school_closed', 'cook_absent', 'no_water_or_fuel', 'learners_sent_home',
    -- feeding happened but the day was unusual
    'half_day', 'school_event', 'exams', 'visitors_fed', 'new_learners',
    'other'));

COMMIT;
