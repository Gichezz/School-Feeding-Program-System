-- Migration 012: the stock ledger.
-- stock_movements is append-only: food received (a delivery against its delivery
-- note or dispatch reference, or a purchase against a receipt for cash-transfer
-- schools), losses and returns. A mistake is corrected with a reversing entry, as
-- in a paper store ledger; the database refuses updates and deletes.
-- stock_counts records physical counts of the store, which is the only way food
-- that left without a record (leakage) shows up.
-- Daily issues of cereals and pulses are not ledger rows: they come from
-- daily_feeding, so an issue has one source and editing a day cannot count it
-- twice. Oil and salt issues are derived from the ration x learners fed.
-- New databases get these from schema.sql and do not need this script.
--
-- Run with: psql -U postgres -d <database> -f database/migrations/012_stock_ledger.sql

BEGIN;

CREATE TABLE IF NOT EXISTS stock_movements (
    -- generated on the device, so a replayed entry is recognised
    id              UUID PRIMARY KEY,
    school_id       UUID NOT NULL,
    movement_date   DATE NOT NULL,
    commodity       TEXT NOT NULL,
    kind            TEXT NOT NULL,
    quantity_kg     NUMERIC(10, 2) NOT NULL,
    -- what the delivery note or dispatch says was sent, when it differs
    note_quantity_kg NUMERIC(10, 2),
    reference       TEXT,
    supplier        TEXT,
    note            TEXT,
    -- set on a reversing entry: the entry it cancels
    reverses_id     UUID,
    captured_by     UUID,
    device_id       UUID,
    captured_at     TIMESTAMPTZ,
    received_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    sync_batch_id   UUID,
    client_id       TEXT,
    change_xid      XID8,
    CONSTRAINT stock_movements_commodity_check CHECK (commodity IN ('cereals', 'pulses', 'oil', 'salt')),
    -- delivery and purchase add stock; loss and return remove it; reversal undoes an entry
    CONSTRAINT stock_movements_kind_check CHECK (kind IN ('delivery', 'purchase', 'loss', 'return', 'reversal')),
    CONSTRAINT stock_movements_quantity_positive CHECK (quantity_kg > 0),
    CONSTRAINT stock_movements_note_quantity CHECK (note_quantity_kg IS NULL OR note_quantity_kg > 0),
    CONSTRAINT stock_movements_reference_required CHECK (
        kind NOT IN ('delivery', 'purchase') OR (reference IS NOT NULL AND btrim(reference) <> '')),
    CONSTRAINT stock_movements_loss_explained CHECK (
        kind NOT IN ('loss', 'return') OR (note IS NOT NULL AND btrim(note) <> '')),
    CONSTRAINT stock_movements_reversal CHECK ((kind = 'reversal') = (reverses_id IS NOT NULL)),
    -- an entry can be reversed only once
    CONSTRAINT stock_movements_reverses_unique UNIQUE (reverses_id),
    CONSTRAINT stock_movements_school_fk FOREIGN KEY (school_id) REFERENCES schools (id)
        ON UPDATE CASCADE ON DELETE RESTRICT,
    CONSTRAINT stock_movements_reverses_fk FOREIGN KEY (reverses_id) REFERENCES stock_movements (id)
        ON UPDATE RESTRICT ON DELETE RESTRICT,
    CONSTRAINT stock_movements_batch_fk FOREIGN KEY (sync_batch_id) REFERENCES sync_batches (id)
        ON UPDATE CASCADE ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS stock_counts (
    id              UUID PRIMARY KEY,
    school_id       UUID NOT NULL,
    count_date      DATE NOT NULL,
    commodity       TEXT NOT NULL,
    counted_kg      NUMERIC(10, 2) NOT NULL,
    note            TEXT,
    captured_by     UUID,
    device_id       UUID,
    captured_at     TIMESTAMPTZ,
    received_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    sync_batch_id   UUID,
    client_id       TEXT,
    change_xid      XID8,
    CONSTRAINT stock_counts_commodity_check CHECK (commodity IN ('cereals', 'pulses', 'oil', 'salt')),
    CONSTRAINT stock_counts_nonneg CHECK (counted_kg >= 0),
    CONSTRAINT stock_counts_school_fk FOREIGN KEY (school_id) REFERENCES schools (id)
        ON UPDATE CASCADE ON DELETE RESTRICT,
    CONSTRAINT stock_counts_batch_fk FOREIGN KEY (sync_batch_id) REFERENCES sync_batches (id)
        ON UPDATE CASCADE ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_stock_movements_school_date ON stock_movements (school_id, movement_date);
CREATE INDEX IF NOT EXISTS idx_stock_movements_change_xid ON stock_movements (change_xid);
CREATE INDEX IF NOT EXISTS idx_stock_counts_school_date ON stock_counts (school_id, count_date);
CREATE INDEX IF NOT EXISTS idx_stock_counts_change_xid ON stock_counts (change_xid);

DROP TRIGGER IF EXISTS stock_movements_change_xid ON stock_movements;
CREATE TRIGGER stock_movements_change_xid BEFORE INSERT ON stock_movements
    FOR EACH ROW EXECUTE FUNCTION set_change_xid();
DROP TRIGGER IF EXISTS stock_movements_append_only ON stock_movements;
CREATE TRIGGER stock_movements_append_only BEFORE UPDATE OR DELETE ON stock_movements
    FOR EACH ROW EXECUTE FUNCTION refuse_change();
DROP TRIGGER IF EXISTS stock_counts_change_xid ON stock_counts;
CREATE TRIGGER stock_counts_change_xid BEFORE INSERT ON stock_counts
    FOR EACH ROW EXECUTE FUNCTION set_change_xid();
DROP TRIGGER IF EXISTS stock_counts_append_only ON stock_counts;
CREATE TRIGGER stock_counts_append_only BEFORE UPDATE OR DELETE ON stock_counts
    FOR EACH ROW EXECUTE FUNCTION refuse_change();

-- Every flow in and out of a school's store, in kilograms (positive = in).
-- Cereals and pulses issued come from the daily record; oil and salt are derived
-- from the school's ration x learners fed.
CREATE OR REPLACE VIEW stock_flows AS
    SELECT m.school_id, m.movement_date AS flow_date, m.commodity, m.kind AS source,
           CASE m.kind
               WHEN 'delivery' THEN m.quantity_kg
               WHEN 'purchase' THEN m.quantity_kg
               WHEN 'reversal' THEN -(SELECT CASE r.kind WHEN 'delivery' THEN r.quantity_kg
                                                          WHEN 'purchase' THEN r.quantity_kg
                                                          ELSE -r.quantity_kg END
                                     FROM stock_movements r WHERE r.id = m.reverses_id)
               ELSE -m.quantity_kg
           END AS quantity_kg
    FROM stock_movements m
    UNION ALL
    SELECT f.school_id, f.feeding_date, 'cereals', 'issue', -f.cereals_kg FROM daily_feeding f
    UNION ALL
    SELECT f.school_id, f.feeding_date, 'pulses', 'issue', -f.pulses_kg FROM daily_feeding f
    UNION ALL
    SELECT f.school_id, f.feeding_date, 'oil', 'issue', -(f.learners_fed * s.ration_oil_g / 1000.0)
    FROM daily_feeding f JOIN schools s ON s.id = f.school_id
    UNION ALL
    SELECT f.school_id, f.feeding_date, 'salt', 'issue', -(f.learners_fed * s.ration_salt_g / 1000.0)
    FROM daily_feeding f JOIN schools s ON s.id = f.school_id;

COMMIT;
