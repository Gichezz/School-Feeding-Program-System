-- Migration 016: practice terms.
-- A practice term is a labelled period outside the national calendar (for example for a
-- demonstration or training while schools are on holiday). It has no term number, so it
-- never takes the place of Term 1, 2 or 3, and it must have a label, which the app shows
-- wherever a term is named. calendar_kenya.sql never adds one.
-- New databases get this from schema.sql and do not need this script.
--
-- Run with: psql -U postgres -d <database> -f database/migrations/016_practice_terms.sql

BEGIN;

ALTER TABLE school_terms ALTER COLUMN term DROP NOT NULL;
ALTER TABLE school_terms ADD COLUMN IF NOT EXISTS label TEXT;
ALTER TABLE school_terms ADD COLUMN IF NOT EXISTS practice BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE school_terms DROP CONSTRAINT IF EXISTS school_terms_practice;
ALTER TABLE school_terms ADD CONSTRAINT school_terms_practice CHECK (
    (practice AND term IS NULL AND label IS NOT NULL AND btrim(label) <> '')
    OR (NOT practice AND term IS NOT NULL));

COMMIT;
