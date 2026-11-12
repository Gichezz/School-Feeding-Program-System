-- Migration 021: email delivery records and account history.
-- email_deliveries: every email Lishe tries to send (an activation code, or a note that a
-- school device was approved), with its state: queued, failed (the attempt did not
-- reach the provider, with the reason) or accepted (the provider took it; this is not
-- proof that it reached or was read in the inbox). A failed approval note can be sent
-- again without approving the device again.
-- account_events: what happened to an account and who did it, for the administrator's
-- account history. In particular, handing an activation code over in person is its own
-- recorded action, with a note, never a routine fallback.
-- activation_codes.failed_attempts: a code stops working after 5 wrong tries.
-- New databases get this from schema.sql and do not need this script.
--
-- Run with: psql -U postgres -d <database> -f database/migrations/021_email_deliveries_and_account_events.sql

BEGIN;

ALTER TABLE activation_codes ADD COLUMN IF NOT EXISTS failed_attempts INTEGER NOT NULL DEFAULT 0;

CREATE TABLE IF NOT EXISTS email_deliveries (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    kind            TEXT NOT NULL,
    user_id         UUID NOT NULL,
    device_id       UUID,
    status          TEXT NOT NULL DEFAULT 'queued',
    attempts        INTEGER NOT NULL DEFAULT 0,
    last_error      TEXT,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    accepted_at     TIMESTAMPTZ,
    CONSTRAINT email_deliveries_kind_check CHECK (kind IN ('activation', 'device_approved')),
    CONSTRAINT email_deliveries_status_check CHECK (status IN ('queued', 'failed', 'accepted')),
    CONSTRAINT email_deliveries_user_fk FOREIGN KEY (user_id) REFERENCES users (id)
        ON UPDATE CASCADE ON DELETE CASCADE,
    CONSTRAINT email_deliveries_device_fk FOREIGN KEY (device_id) REFERENCES devices (id)
        ON UPDATE CASCADE ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_email_deliveries_user ON email_deliveries (user_id, created_at DESC);

CREATE TABLE IF NOT EXISTS account_events (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id         UUID NOT NULL,
    kind            TEXT NOT NULL,
    actor_id        UUID,
    note            TEXT,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT account_events_kind_check CHECK (kind IN (
        'activation_emailed', 'activation_email_failed', 'activation_handed_over',
        'activation_code_locked', 'activated')),
    CONSTRAINT account_events_note_length CHECK (char_length(note) <= 500),
    CONSTRAINT account_events_user_fk FOREIGN KEY (user_id) REFERENCES users (id)
        ON UPDATE CASCADE ON DELETE CASCADE,
    CONSTRAINT account_events_actor_fk FOREIGN KEY (actor_id) REFERENCES users (id)
        ON UPDATE CASCADE ON DELETE SET NULL
);
CREATE INDEX IF NOT EXISTS idx_account_events_user ON account_events (user_id, created_at DESC);

COMMIT;
