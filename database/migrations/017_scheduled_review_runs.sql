-- Migration 017: weekly review lists scored on a schedule.
-- The API now scores each sub-county's week by itself once the week is over, and scores
-- a recent week again when records for it sync late, so officers find the list waiting.
-- scored_by_schedule marks those runs; a run an officer starts from the page keeps
-- created_by. An officer's run of a week replaces the schedule's, and the other way
-- round; decisions are kept either way.
-- New databases get this from schema.sql and do not need this script.
--
-- Run with: psql -U postgres -d <database> -f database/migrations/017_scheduled_review_runs.sql

BEGIN;

ALTER TABLE review_runs ADD COLUMN IF NOT EXISTS scored_by_schedule BOOLEAN NOT NULL DEFAULT false;

COMMIT;
