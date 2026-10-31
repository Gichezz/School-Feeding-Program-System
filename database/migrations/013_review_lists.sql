-- Migration 013: weekly review lists for programme officers.
-- review_runs: one ranking per sub-county and week, with the model that produced it.
-- review_items: each school's place in that week's ranking, with its reasons.
-- review_decisions: an officer's decision on a school's week (explained or follow-up),
-- kept apart from the runs so re-running a week never loses a decision. Follow-up weeks
-- are left out of later model fits.
-- Also drops forecast_results: meal-demand forecasting has been removed.
-- New databases get these from schema.sql and do not need this script.
--
-- Run with: psql -U postgres -d <database> -f database/migrations/013_review_lists.sql

BEGIN;

CREATE TABLE IF NOT EXISTS review_runs (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    sub_county      TEXT NOT NULL,
    week_start      DATE NOT NULL,
    -- one_class_svm, or rules_only while a sub-county has little history
    mode            TEXT NOT NULL,
    model           JSONB,
    k               INTEGER NOT NULL,
    rule_breaches   JSONB NOT NULL DEFAULT '[]',
    created_by      UUID,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT review_runs_unique UNIQUE (sub_county, week_start),
    CONSTRAINT review_runs_monday CHECK (EXTRACT(ISODOW FROM week_start) = 1),
    CONSTRAINT review_runs_mode_check CHECK (mode IN ('one_class_svm', 'rules_only', 'no_records')),
    CONSTRAINT review_runs_k_positive CHECK (k > 0),
    CONSTRAINT review_runs_created_by_fk FOREIGN KEY (created_by) REFERENCES users (id)
        ON UPDATE CASCADE ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS review_items (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    run_id          UUID NOT NULL,
    school_id       UUID NOT NULL,
    rank            INTEGER NOT NULL,
    listed          BOOLEAN NOT NULL,
    score           DOUBLE PRECISION NOT NULL,
    top_date        DATE,
    reasons         JSONB NOT NULL DEFAULT '[]',
    explanation     TEXT NOT NULL,
    CONSTRAINT review_items_unique UNIQUE (run_id, school_id),
    CONSTRAINT review_items_rank_positive CHECK (rank > 0),
    CONSTRAINT review_items_run_fk FOREIGN KEY (run_id) REFERENCES review_runs (id)
        ON UPDATE CASCADE ON DELETE CASCADE,
    CONSTRAINT review_items_school_fk FOREIGN KEY (school_id) REFERENCES schools (id)
        ON UPDATE CASCADE ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS review_decisions (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    school_id       UUID NOT NULL,
    week_start      DATE NOT NULL,
    status          TEXT NOT NULL,
    note            TEXT,
    reviewed_by     UUID,
    reviewed_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT review_decisions_unique UNIQUE (school_id, week_start),
    CONSTRAINT review_decisions_status_check CHECK (status IN ('explained', 'follow_up')),
    -- An explanation is what makes "explained" useful to the next officer
    CONSTRAINT review_decisions_note_required CHECK (note IS NOT NULL AND btrim(note) <> ''),
    CONSTRAINT review_decisions_school_fk FOREIGN KEY (school_id) REFERENCES schools (id)
        ON UPDATE CASCADE ON DELETE CASCADE,
    CONSTRAINT review_decisions_reviewed_by_fk FOREIGN KEY (reviewed_by) REFERENCES users (id)
        ON UPDATE CASCADE ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_review_items_run ON review_items (run_id, rank);
CREATE INDEX IF NOT EXISTS idx_review_decisions_week ON review_decisions (week_start);

DROP TABLE IF EXISTS forecast_results;

COMMIT;
