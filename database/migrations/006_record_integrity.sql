-- Migration 006: record integrity controls (#62).
-- Adds who captured each attendance and meal record, on which device and when, the
-- reason for late entries, every saved version (record_history) and review flags
-- (record_flags). Existing records keep these fields empty.
-- New databases get these from schema.sql and do not need this script.
--
-- Run with: psql -U postgres -d <database> -f database/migrations/006_record_integrity.sql

BEGIN;

ALTER TABLE attendance_records ADD COLUMN IF NOT EXISTS captured_by UUID;
ALTER TABLE attendance_records ADD COLUMN IF NOT EXISTS device_id UUID;
ALTER TABLE attendance_records ADD COLUMN IF NOT EXISTS captured_at TIMESTAMPTZ;
ALTER TABLE attendance_records ADD COLUMN IF NOT EXISTS received_at TIMESTAMPTZ;
ALTER TABLE attendance_records ADD COLUMN IF NOT EXISTS late_reason TEXT;

ALTER TABLE meal_distributions ADD COLUMN IF NOT EXISTS captured_by UUID;
ALTER TABLE meal_distributions ADD COLUMN IF NOT EXISTS device_id UUID;
ALTER TABLE meal_distributions ADD COLUMN IF NOT EXISTS captured_at TIMESTAMPTZ;
ALTER TABLE meal_distributions ADD COLUMN IF NOT EXISTS received_at TIMESTAMPTZ;
ALTER TABLE meal_distributions ADD COLUMN IF NOT EXISTS late_reason TEXT;

CREATE TABLE IF NOT EXISTS record_history (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    entity_type     TEXT NOT NULL,
    record_id       UUID NOT NULL,
    version         INTEGER NOT NULL,
    -- the counts and date as saved in this version
    values          JSONB NOT NULL,
    changed_by      UUID,
    device_id       UUID,
    captured_at     TIMESTAMPTZ,
    changed_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT record_history_entity_type_check CHECK (entity_type IN ('attendance', 'meal_distribution')),
    CONSTRAINT record_history_changed_by_fk
        FOREIGN KEY (changed_by) REFERENCES users (id)
        ON UPDATE CASCADE
        ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS record_flags (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    entity_type     TEXT NOT NULL,
    record_id       UUID NOT NULL,
    version         INTEGER NOT NULL,
    flag            TEXT NOT NULL,
    detail          TEXT NOT NULL,
    status          TEXT NOT NULL DEFAULT 'open',
    note            TEXT,
    checked_by      UUID,
    checked_at      TIMESTAMPTZ,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT record_flags_unique UNIQUE (entity_type, record_id, version, flag),
    CONSTRAINT record_flags_entity_type_check CHECK (entity_type IN ('attendance', 'meal_distribution')),
    CONSTRAINT record_flags_flag_check CHECK (flag IN ('outside_hours', 'entered_late', 'synced_late', 'served_exceeds_present', 'unusual_numbers')),
    CONSTRAINT record_flags_status_check CHECK (status IN ('open', 'checked')),
    CONSTRAINT record_flags_checked_by_fk
        FOREIGN KEY (checked_by) REFERENCES users (id)
        ON UPDATE CASCADE
        ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_record_history_record
    ON record_history (entity_type, record_id);

CREATE INDEX IF NOT EXISTS idx_record_flags_status
    ON record_flags (status);

COMMIT;
