-- Migration 014: duplicate delivery notes, and held-record decisions reaching devices.
-- A delivery recorded with the same school, commodity and delivery note as one already
-- on the server (and not reversed) is held for a person to apply or discard, instead of
-- being counted twice: the cook and the head teacher may both enter the same note.
-- Decisions on held records are stamped with their transaction (decided_xid), so the
-- school's devices download them: a discarded record leaves the device's stock balance.
-- New databases get these from schema.sql and do not need this script.
--
-- Run with: psql -U postgres -d <database> -f database/migrations/014_held_decisions.sql

BEGIN;

ALTER TABLE held_operations DROP CONSTRAINT IF EXISTS held_operations_reason_check;
ALTER TABLE held_operations ADD CONSTRAINT held_operations_reason_check
    CHECK (reason IN ('user_deactivated', 'password_reset', 'device_revoked', 'duplicate_delivery'));

ALTER TABLE held_operations ADD COLUMN IF NOT EXISTS decided_xid XID8;
CREATE INDEX IF NOT EXISTS idx_held_operations_decided_xid ON held_operations (decided_xid);

-- Finding an earlier delivery with the same note
CREATE INDEX IF NOT EXISTS idx_stock_movements_delivery_note
    ON stock_movements (school_id, commodity, lower(btrim(reference))) WHERE kind = 'delivery';

COMMIT;
