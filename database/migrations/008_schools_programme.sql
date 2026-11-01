-- Migration 008: schools in a feeding programme, and programme officers.
-- Schools get their county, sub-county, programme type (food delivered in kind, or
-- a cash transfer the school buys food with) and ration per learner per day.
-- Programme officers oversee every school in their sub-county.
-- New databases get these from schema.sql and do not need this script.
--
-- Run with: psql -U postgres -d <database> -f database/migrations/008_schools_programme.sql

BEGIN;

ALTER TABLE schools ADD COLUMN IF NOT EXISTS county TEXT;
ALTER TABLE schools ADD COLUMN IF NOT EXISTS sub_county TEXT;
ALTER TABLE schools ADD COLUMN IF NOT EXISTS programme_type TEXT NOT NULL DEFAULT 'in_kind';
-- Grams per learner per day; the School Meals Programme ration by default
ALTER TABLE schools ADD COLUMN IF NOT EXISTS ration_cereals_g NUMERIC(6, 1) NOT NULL DEFAULT 150;
ALTER TABLE schools ADD COLUMN IF NOT EXISTS ration_pulses_g NUMERIC(6, 1) NOT NULL DEFAULT 40;
ALTER TABLE schools ADD COLUMN IF NOT EXISTS ration_oil_g NUMERIC(6, 1) NOT NULL DEFAULT 5;
ALTER TABLE schools ADD COLUMN IF NOT EXISTS ration_salt_g NUMERIC(6, 1) NOT NULL DEFAULT 2;

ALTER TABLE schools DROP CONSTRAINT IF EXISTS schools_programme_type_check;
ALTER TABLE schools ADD CONSTRAINT schools_programme_type_check
    CHECK (programme_type IN ('in_kind', 'cash_transfer'));
ALTER TABLE schools DROP CONSTRAINT IF EXISTS schools_ration_positive;
ALTER TABLE schools ADD CONSTRAINT schools_ration_positive
    CHECK (ration_cereals_g > 0 AND ration_pulses_g > 0 AND ration_oil_g >= 0 AND ration_salt_g >= 0);

CREATE INDEX IF NOT EXISTS idx_schools_sub_county ON schools (sub_county);

-- Programme officers belong to a sub-county instead of a school
ALTER TABLE users ADD COLUMN IF NOT EXISTS sub_county TEXT;
ALTER TABLE users DROP CONSTRAINT IF EXISTS users_role_check;
ALTER TABLE users ADD CONSTRAINT users_role_check
    CHECK (role IN ('admin', 'programme_officer', 'school_staff'));
ALTER TABLE users DROP CONSTRAINT IF EXISTS users_officer_sub_county;
ALTER TABLE users ADD CONSTRAINT users_officer_sub_county
    CHECK (role <> 'programme_officer' OR sub_county IS NOT NULL);

COMMIT;
