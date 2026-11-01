-- Migration 009: the school calendar.
-- school_terms holds the national term dates published by the Ministry of Education;
-- calendar_events holds public holidays and national exams (school_id empty) and a
-- school's own closures and events. Together they give the days a school is
-- expected to feed learners.
-- New databases get these from schema.sql and do not need this script.
--
-- Run with: psql -U postgres -d <database> -f database/migrations/009_calendar.sql

BEGIN;

CREATE TABLE IF NOT EXISTS school_terms (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    year            SMALLINT NOT NULL,
    term            SMALLINT NOT NULL,
    opens_on        DATE NOT NULL,
    closes_on       DATE NOT NULL,
    -- the days learners are away for half-term, if the term has one
    half_term_start DATE,
    half_term_end   DATE,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT school_terms_unique UNIQUE (year, term),
    CONSTRAINT school_terms_term_check CHECK (term BETWEEN 1 AND 3),
    CONSTRAINT school_terms_dates_order CHECK (closes_on > opens_on),
    CONSTRAINT school_terms_half_term CHECK (
        (half_term_start IS NULL AND half_term_end IS NULL)
        OR (half_term_start > opens_on AND half_term_end >= half_term_start AND half_term_end < closes_on)
    )
);

CREATE TABLE IF NOT EXISTS calendar_events (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    -- empty for national dates that apply to every school
    school_id       UUID,
    starts_on       DATE NOT NULL,
    ends_on         DATE NOT NULL,
    kind            TEXT NOT NULL,
    name            TEXT NOT NULL,
    created_by      UUID,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT calendar_events_kind_check
        CHECK (kind IN ('public_holiday', 'national_exam', 'school_closure', 'school_event')),
    CONSTRAINT calendar_events_dates_order CHECK (ends_on >= starts_on),
    -- closures and events belong to one school; holidays and exams are national
    CONSTRAINT calendar_events_scope CHECK (
        (kind IN ('public_holiday', 'national_exam') AND school_id IS NULL)
        OR (kind IN ('school_closure', 'school_event') AND school_id IS NOT NULL)
    ),
    CONSTRAINT calendar_events_school_fk
        FOREIGN KEY (school_id) REFERENCES schools (id)
        ON UPDATE CASCADE
        ON DELETE CASCADE,
    CONSTRAINT calendar_events_created_by_fk
        FOREIGN KEY (created_by) REFERENCES users (id)
        ON UPDATE CASCADE
        ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_calendar_events_dates ON calendar_events (starts_on, ends_on);
CREATE INDEX IF NOT EXISTS idx_calendar_events_school ON calendar_events (school_id);

COMMIT;
