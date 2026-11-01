-- Migration 015: weekly review lists scored by Extended Isolation Forest.
-- Protocol version 6 chose Extended Isolation Forest for the weekly review list
-- (docs/anomaly-detection.md). Runs it scores are stored with mode
-- 'extended_isolation_forest'; earlier runs keep 'one_class_svm', which stays allowed.
-- New databases get this from schema.sql and do not need this script.
--
-- Run with: psql -U postgres -d <database> -f database/migrations/015_review_model.sql

BEGIN;

ALTER TABLE review_runs DROP CONSTRAINT IF EXISTS review_runs_mode_check;
ALTER TABLE review_runs ADD CONSTRAINT review_runs_mode_check
    CHECK (mode IN ('extended_isolation_forest', 'one_class_svm', 'rules_only', 'no_records'));

COMMIT;
