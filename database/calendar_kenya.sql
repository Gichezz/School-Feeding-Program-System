-- National school calendar for Kenya: term dates, half-terms, public holidays and
-- national exams for 2024-2026, from the Ministry of Education calendars (sources and
-- disputed dates: forecasting/config/kenya_inputs.yaml, which holds the same dates).
-- Reference data every installation needs, not demo data. Safe to run again.
-- Add each new year from the Ministry's circular in the same way.
--
-- Run after schema.sql: psql -U postgres -d <database> -f database/calendar_kenya.sql

BEGIN;

INSERT INTO school_terms (year, term, opens_on, closes_on, half_term_start, half_term_end)
VALUES
    (2024, 1, DATE '2024-01-08', DATE '2024-04-05', DATE '2024-02-29', DATE '2024-03-03'),
    (2024, 2, DATE '2024-04-29', DATE '2024-08-02', DATE '2024-06-20', DATE '2024-06-23'),
    (2024, 3, DATE '2024-08-26', DATE '2024-10-25', NULL, NULL),
    (2025, 1, DATE '2025-01-06', DATE '2025-04-04', DATE '2025-02-26', DATE '2025-03-02'),
    (2025, 2, DATE '2025-04-28', DATE '2025-08-01', DATE '2025-06-25', DATE '2025-06-29'),
    (2025, 3, DATE '2025-08-25', DATE '2025-10-24', NULL, NULL),
    (2026, 1, DATE '2026-01-05', DATE '2026-04-02', DATE '2026-02-25', DATE '2026-03-01'),
    (2026, 2, DATE '2026-04-27', DATE '2026-07-31', DATE '2026-06-24', DATE '2026-06-28'),
    (2026, 3, DATE '2026-08-24', DATE '2026-10-23', NULL, NULL)
ON CONFLICT (year, term) DO UPDATE SET
    opens_on = EXCLUDED.opens_on, closes_on = EXCLUDED.closes_on,
    half_term_start = EXCLUDED.half_term_start, half_term_end = EXCLUDED.half_term_end;

-- National dates are replaced as a whole so the file can be run again
DELETE FROM calendar_events WHERE school_id IS NULL AND kind IN ('public_holiday', 'national_exam')
    AND starts_on BETWEEN DATE '2024-01-01' AND DATE '2026-12-31';

INSERT INTO calendar_events (starts_on, ends_on, kind, name)
VALUES
    (DATE '2024-01-01', DATE '2024-01-01', 'public_holiday', 'New Year''s Day'),
    (DATE '2024-03-29', DATE '2024-03-29', 'public_holiday', 'Good Friday'),
    (DATE '2024-04-01', DATE '2024-04-01', 'public_holiday', 'Easter Monday'),
    (DATE '2024-04-10', DATE '2024-04-10', 'public_holiday', 'Eid al-Fitr'),
    (DATE '2024-05-01', DATE '2024-05-01', 'public_holiday', 'Labour Day'),
    (DATE '2024-06-01', DATE '2024-06-01', 'public_holiday', 'Madaraka Day'),
    (DATE '2024-10-10', DATE '2024-10-10', 'public_holiday', 'Mazingira Day'),
    (DATE '2024-10-21', DATE '2024-10-21', 'public_holiday', 'Mashujaa Day'),
    (DATE '2024-10-28', DATE '2024-10-31', 'national_exam', 'KPSEA 2024'),
    (DATE '2024-11-04', DATE '2024-11-22', 'national_exam', 'KCSE 2024'),
    (DATE '2024-12-12', DATE '2024-12-12', 'public_holiday', 'Jamhuri Day'),
    (DATE '2024-12-25', DATE '2024-12-25', 'public_holiday', 'Christmas Day'),
    (DATE '2024-12-26', DATE '2024-12-26', 'public_holiday', 'Boxing Day'),
    (DATE '2025-01-01', DATE '2025-01-01', 'public_holiday', 'New Year''s Day'),
    (DATE '2025-03-31', DATE '2025-03-31', 'public_holiday', 'Eid al-Fitr'),
    (DATE '2025-04-18', DATE '2025-04-18', 'public_holiday', 'Good Friday'),
    (DATE '2025-04-21', DATE '2025-04-21', 'public_holiday', 'Easter Monday'),
    (DATE '2025-05-01', DATE '2025-05-01', 'public_holiday', 'Labour Day'),
    (DATE '2025-06-02', DATE '2025-06-02', 'public_holiday', 'Madaraka Day'),
    (DATE '2025-10-10', DATE '2025-10-10', 'public_holiday', 'Mazingira Day'),
    (DATE '2025-10-20', DATE '2025-10-20', 'public_holiday', 'Mashujaa Day'),
    (DATE '2025-10-27', DATE '2025-10-30', 'national_exam', 'KPSEA 2025'),
    (DATE '2025-10-27', DATE '2025-11-06', 'national_exam', 'KJSEA 2025'),
    (DATE '2025-11-03', DATE '2025-11-21', 'national_exam', 'KCSE 2025'),
    (DATE '2025-12-12', DATE '2025-12-12', 'public_holiday', 'Jamhuri Day'),
    (DATE '2025-12-25', DATE '2025-12-25', 'public_holiday', 'Christmas Day'),
    (DATE '2025-12-26', DATE '2025-12-26', 'public_holiday', 'Boxing Day'),
    (DATE '2026-01-01', DATE '2026-01-01', 'public_holiday', 'New Year''s Day'),
    (DATE '2026-03-20', DATE '2026-03-20', 'public_holiday', 'Eid al-Fitr'),
    (DATE '2026-04-03', DATE '2026-04-03', 'public_holiday', 'Good Friday'),
    (DATE '2026-04-06', DATE '2026-04-06', 'public_holiday', 'Easter Monday'),
    (DATE '2026-05-01', DATE '2026-05-01', 'public_holiday', 'Labour Day'),
    (DATE '2026-06-01', DATE '2026-06-01', 'public_holiday', 'Madaraka Day'),
    (DATE '2026-10-10', DATE '2026-10-10', 'public_holiday', 'Mazingira Day'),
    (DATE '2026-10-20', DATE '2026-10-20', 'public_holiday', 'Mashujaa Day'),
    (DATE '2026-10-26', DATE '2026-10-30', 'national_exam', 'KPSEA 2026'),
    (DATE '2026-10-26', DATE '2026-11-05', 'national_exam', 'KJSEA 2026'),
    (DATE '2026-11-02', DATE '2026-11-20', 'national_exam', 'KCSE 2026'),
    (DATE '2026-12-12', DATE '2026-12-12', 'public_holiday', 'Jamhuri Day'),
    (DATE '2026-12-25', DATE '2026-12-25', 'public_holiday', 'Christmas Day'),
    (DATE '2026-12-26', DATE '2026-12-26', 'public_holiday', 'Boxing Day');

COMMIT;
