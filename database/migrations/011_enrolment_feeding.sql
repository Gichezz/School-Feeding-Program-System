-- Migration 011: termly enrolment and the daily feeding record.
-- enrolment: learners on the register per term, class and sex; a programme officer
-- verifies it, and only verified enrolment counts towards the termly requirement.
-- daily_feeding: one record per school day: whether feeding happened, learners fed,
-- kilograms of cereals and pulses issued from the store, and a reason code when
-- feeding did not happen or the day was unusual. Learners present is optional.
-- Both carry the integrity metadata: the date described against when it was
-- captured and received, the sync batch, and the version (edits = version - 1).
-- New databases get these from schema.sql and do not need this script.
--
-- Run with: psql -U postgres -d <database> -f database/migrations/011_enrolment_feeding.sql

BEGIN;

CREATE TABLE IF NOT EXISTS enrolment (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    school_id       UUID NOT NULL,
    term_id         UUID NOT NULL,
    class           TEXT NOT NULL,
    sex             CHAR(1) NOT NULL,
    learners        INTEGER NOT NULL,
    verified_by     UUID,
    verified_at     TIMESTAMPTZ,
    captured_by     UUID,
    device_id       UUID,
    captured_at     TIMESTAMPTZ,
    received_at     TIMESTAMPTZ,
    sync_batch_id   UUID,
    version         INTEGER NOT NULL DEFAULT 1,
    updated_by      UUID,
    client_id       TEXT,
    change_xid      XID8,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT enrolment_unique UNIQUE (school_id, term_id, class, sex),
    CONSTRAINT enrolment_class_check CHECK (class IN (
        'PP1', 'PP2', 'Grade 1', 'Grade 2', 'Grade 3', 'Grade 4', 'Grade 5', 'Grade 6',
        'Grade 7', 'Grade 8', 'Grade 9')),
    CONSTRAINT enrolment_sex_check CHECK (sex IN ('F', 'M')),
    CONSTRAINT enrolment_learners_nonneg CHECK (learners >= 0),
    CONSTRAINT enrolment_version_positive CHECK (version >= 1),
    CONSTRAINT enrolment_school_fk FOREIGN KEY (school_id) REFERENCES schools (id)
        ON UPDATE CASCADE ON DELETE RESTRICT,
    CONSTRAINT enrolment_term_fk FOREIGN KEY (term_id) REFERENCES school_terms (id)
        ON UPDATE CASCADE ON DELETE RESTRICT,
    CONSTRAINT enrolment_verified_by_fk FOREIGN KEY (verified_by) REFERENCES users (id)
        ON UPDATE CASCADE ON DELETE SET NULL,
    CONSTRAINT enrolment_updated_by_fk FOREIGN KEY (updated_by) REFERENCES users (id)
        ON UPDATE CASCADE ON DELETE SET NULL,
    CONSTRAINT enrolment_batch_fk FOREIGN KEY (sync_batch_id) REFERENCES sync_batches (id)
        ON UPDATE CASCADE ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS daily_feeding (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    school_id           UUID NOT NULL,
    feeding_date        DATE NOT NULL,
    feeding_happened    BOOLEAN NOT NULL,
    learners_present    INTEGER,
    learners_fed        INTEGER NOT NULL DEFAULT 0,
    cereals_kg          NUMERIC(8, 2) NOT NULL DEFAULT 0,
    pulses_kg           NUMERIC(8, 2) NOT NULL DEFAULT 0,
    reason_code         TEXT,
    note                TEXT,
    late_reason         TEXT,
    captured_by         UUID,
    device_id           UUID,
    captured_at         TIMESTAMPTZ,
    received_at         TIMESTAMPTZ,
    sync_batch_id       UUID,
    version             INTEGER NOT NULL DEFAULT 1,
    updated_by          UUID,
    client_id           TEXT,
    change_xid          XID8,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT daily_feeding_unique UNIQUE (school_id, feeding_date),
    CONSTRAINT daily_feeding_counts_nonneg CHECK (
        learners_fed >= 0 AND cereals_kg >= 0 AND pulses_kg >= 0
        AND (learners_present IS NULL OR learners_present >= 0)),
    CONSTRAINT daily_feeding_fed_within_present CHECK (
        learners_present IS NULL OR learners_fed <= learners_present),
    -- No feeding means nothing fed or issued, and a reason
    CONSTRAINT daily_feeding_not_fed CHECK (
        feeding_happened OR (learners_fed = 0 AND cereals_kg = 0 AND pulses_kg = 0 AND reason_code IS NOT NULL)),
    CONSTRAINT daily_feeding_reason_check CHECK (reason_code IS NULL OR reason_code IN (
        -- feeding did not happen
        'no_food', 'school_closed', 'cook_absent', 'no_water_or_fuel', 'learners_sent_home',
        -- feeding happened but the day was unusual
        'half_day', 'school_event', 'exams', 'visitors_fed',
        'other')),
    CONSTRAINT daily_feeding_other_explained CHECK (
        reason_code IS DISTINCT FROM 'other' OR (note IS NOT NULL AND btrim(note) <> '')),
    CONSTRAINT daily_feeding_version_positive CHECK (version >= 1),
    CONSTRAINT daily_feeding_school_fk FOREIGN KEY (school_id) REFERENCES schools (id)
        ON UPDATE CASCADE ON DELETE RESTRICT,
    CONSTRAINT daily_feeding_updated_by_fk FOREIGN KEY (updated_by) REFERENCES users (id)
        ON UPDATE CASCADE ON DELETE SET NULL,
    CONSTRAINT daily_feeding_batch_fk FOREIGN KEY (sync_batch_id) REFERENCES sync_batches (id)
        ON UPDATE CASCADE ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_enrolment_school_term ON enrolment (school_id, term_id);
CREATE INDEX IF NOT EXISTS idx_enrolment_change_xid ON enrolment (change_xid);
CREATE INDEX IF NOT EXISTS idx_daily_feeding_school_date ON daily_feeding (school_id, feeding_date);
CREATE INDEX IF NOT EXISTS idx_daily_feeding_change_xid ON daily_feeding (change_xid);

DROP TRIGGER IF EXISTS enrolment_change_xid ON enrolment;
CREATE TRIGGER enrolment_change_xid BEFORE INSERT OR UPDATE ON enrolment
    FOR EACH ROW EXECUTE FUNCTION set_change_xid();
DROP TRIGGER IF EXISTS daily_feeding_change_xid ON daily_feeding;
CREATE TRIGGER daily_feeding_change_xid BEFORE INSERT OR UPDATE ON daily_feeding
    FOR EACH ROW EXECUTE FUNCTION set_change_xid();

COMMIT;
