-- Migration 018: who witnessed a delivery.
-- In a school feeding programme a delivery is received by the teacher in charge and
-- witnessed by a second person, usually a school meals committee member who signs the
-- delivery note. stock_movements.witness keeps that person's name with the entry, so
-- the ledger shows the same two-person check as the paper note. It is a name, not an
-- account: the witness never signs in. Optional, as the paper note may not name one.
-- New databases get this from schema.sql and do not need this script.
--
-- Run with: psql -U postgres -d <database> -f database/migrations/018_delivery_witness.sql

BEGIN;

ALTER TABLE stock_movements ADD COLUMN IF NOT EXISTS witness TEXT;

COMMIT;
