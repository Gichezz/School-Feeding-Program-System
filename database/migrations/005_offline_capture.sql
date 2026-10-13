-- Migration 005: offline PIN sign-in and records tied to who captured them (#61).
-- Records which user and school device captured each synced record, when an
-- administrator last reset each password, and adds held_operations for records an
-- administrator must review.
-- New databases get these from schema.sql and do not need this script.
--
-- Run with: psql -U postgres -d <database> -f database/migrations/005_offline_capture.sql

BEGIN;

ALTER TABLE users ADD COLUMN IF NOT EXISTS password_reset_at TIMESTAMPTZ;

ALTER TABLE sync_operations ADD COLUMN IF NOT EXISTS captured_by UUID;
ALTER TABLE sync_operations ADD COLUMN IF NOT EXISTS device_id UUID;
ALTER TABLE sync_operations ADD COLUMN IF NOT EXISTS captured_at TIMESTAMPTZ;

CREATE TABLE IF NOT EXISTS held_operations (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    operation_id    TEXT NOT NULL,
    entity_type     TEXT NOT NULL,
    operation_type  TEXT NOT NULL,
    payload         JSONB NOT NULL,
    base_version    INTEGER NOT NULL DEFAULT 0,
    client_id       TEXT NOT NULL,
    captured_by     UUID,
    device_id       UUID,
    captured_at     TIMESTAMPTZ,
    -- the signed-in user whose sync handed the record in
    submitted_by    UUID,
    reason          TEXT NOT NULL,
    status          TEXT NOT NULL DEFAULT 'pending',
    reviewed_by     UUID,
    reviewed_at     TIMESTAMPTZ,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT held_operations_operation_unique UNIQUE (operation_id),
    CONSTRAINT held_operations_entity_type_check CHECK (entity_type IN ('attendance', 'meal_distribution')),
    CONSTRAINT held_operations_operation_type_check CHECK (operation_type IN ('create', 'update')),
    CONSTRAINT held_operations_reason_check CHECK (reason IN ('user_deactivated', 'password_reset', 'device_revoked')),
    CONSTRAINT held_operations_status_check CHECK (status IN ('pending', 'applied', 'discarded')),
    CONSTRAINT held_operations_captured_by_fk
        FOREIGN KEY (captured_by) REFERENCES users (id)
        ON UPDATE CASCADE
        ON DELETE SET NULL,
    CONSTRAINT held_operations_submitted_by_fk
        FOREIGN KEY (submitted_by) REFERENCES users (id)
        ON UPDATE CASCADE
        ON DELETE SET NULL,
    CONSTRAINT held_operations_reviewed_by_fk
        FOREIGN KEY (reviewed_by) REFERENCES users (id)
        ON UPDATE CASCADE
        ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_held_operations_status
    ON held_operations (status);

COMMIT;
