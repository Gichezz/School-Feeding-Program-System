-- Migration 010: sync batches and the change sequence.
-- Every sync request is a batch; the records it applies carry the batch id, so a
-- backdated bulk entry is visible as many dates arriving in one batch.
-- record_change_seq numbers every insert and update of a synced record; devices
-- download what changed after the last number they saw (server order, never
-- device clocks).
-- The entity types are widened for the records added by migrations 011 and 012.
-- New databases get these from schema.sql and do not need this script.
--
-- Run with: psql -U postgres -d <database> -f database/migrations/010_sync_batches.sql

BEGIN;

CREATE SEQUENCE IF NOT EXISTS record_change_seq;

-- Gives the row the next change number on every insert and update
CREATE OR REPLACE FUNCTION set_change_seq() RETURNS trigger AS $$
BEGIN
    NEW.change_seq := nextval('record_change_seq');
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- For append-only tables: entries are corrected by a reversing entry, never changed
CREATE OR REPLACE FUNCTION refuse_change() RETURNS trigger AS $$
BEGIN
    RAISE EXCEPTION '% is append-only: add a correcting entry instead', TG_TABLE_NAME
        USING ERRCODE = 'restrict_violation';
END;
$$ LANGUAGE plpgsql;

CREATE TABLE IF NOT EXISTS sync_batches (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    school_id       UUID,
    device_id       UUID,
    user_id         UUID,
    operation_count INTEGER NOT NULL DEFAULT 0,
    received_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT sync_batches_school_fk
        FOREIGN KEY (school_id) REFERENCES schools (id)
        ON UPDATE CASCADE
        ON DELETE SET NULL,
    CONSTRAINT sync_batches_device_fk
        FOREIGN KEY (device_id) REFERENCES devices (id)
        ON UPDATE CASCADE
        ON DELETE SET NULL,
    CONSTRAINT sync_batches_user_fk
        FOREIGN KEY (user_id) REFERENCES users (id)
        ON UPDATE CASCADE
        ON DELETE SET NULL,
    CONSTRAINT sync_batches_count_nonneg CHECK (operation_count >= 0)
);

ALTER TABLE sync_operations ADD COLUMN IF NOT EXISTS sync_batch_id UUID;
ALTER TABLE sync_operations DROP CONSTRAINT IF EXISTS sync_operations_batch_fk;
ALTER TABLE sync_operations ADD CONSTRAINT sync_operations_batch_fk
    FOREIGN KEY (sync_batch_id) REFERENCES sync_batches (id)
    ON UPDATE CASCADE
    ON DELETE SET NULL;

-- Entity types: the records synced from school devices
ALTER TABLE sync_operations DROP CONSTRAINT IF EXISTS sync_operations_entity_type_check;
ALTER TABLE sync_operations ADD CONSTRAINT sync_operations_entity_type_check
    CHECK (entity_type IN ('attendance', 'meal_distribution', 'enrolment', 'daily_feeding',
                           'stock_movement', 'stock_count'));
ALTER TABLE conflicts DROP CONSTRAINT IF EXISTS conflicts_entity_type_check;
ALTER TABLE conflicts ADD CONSTRAINT conflicts_entity_type_check
    CHECK (entity_type IN ('attendance', 'meal_distribution', 'enrolment', 'daily_feeding'));
ALTER TABLE held_operations DROP CONSTRAINT IF EXISTS held_operations_entity_type_check;
ALTER TABLE held_operations ADD CONSTRAINT held_operations_entity_type_check
    CHECK (entity_type IN ('attendance', 'meal_distribution', 'enrolment', 'daily_feeding',
                           'stock_movement', 'stock_count'));
ALTER TABLE record_history DROP CONSTRAINT IF EXISTS record_history_entity_type_check;
ALTER TABLE record_history ADD CONSTRAINT record_history_entity_type_check
    CHECK (entity_type IN ('attendance', 'meal_distribution', 'enrolment', 'daily_feeding'));
ALTER TABLE record_flags DROP CONSTRAINT IF EXISTS record_flags_entity_type_check;
ALTER TABLE record_flags ADD CONSTRAINT record_flags_entity_type_check
    CHECK (entity_type IN ('attendance', 'meal_distribution', 'enrolment', 'daily_feeding',
                           'stock_movement', 'stock_count'));
-- Checks run on every saved record, raised for review and never blocking
ALTER TABLE record_flags DROP CONSTRAINT IF EXISTS record_flags_flag_check;
ALTER TABLE record_flags ADD CONSTRAINT record_flags_flag_check
    CHECK (flag IN ('outside_hours', 'entered_late', 'synced_late', 'served_exceeds_present',
                    'unusual_numbers', 'fed_exceeds_enrolled', 'fed_exceeds_present',
                    'issue_exceeds_stock', 'usage_far_from_ration', 'delivery_short'));

COMMIT;
