-- Demonstration only: a practice term for showing the system while schools are on holiday.
-- Never load this on a real installation. Term 3 2026 ended on 23 October 2026 and the
-- 2027 calendar is not published yet, so a live demonstration between them would record
-- on days the national calendar says are not school days. This adds a clearly labelled
-- practice term (no term number, so it never takes the place of a real term) and copies
-- each school's Term 3 2026 enrolment into it, so its records are checked like any term's.
-- Safe to run again. Needs migration 016 (or a database built from schema.sql).
--
-- Run with: psql -U postgres -d <demo database> -f database/demo/practice_term.sql
-- Remove it: DELETE FROM enrolment WHERE term_id IN (SELECT id FROM school_terms WHERE practice);
--            DELETE FROM school_terms WHERE practice;

BEGIN;

INSERT INTO school_terms (year, term, opens_on, closes_on, label, practice)
SELECT 2026, NULL, DATE '2026-10-26', DATE '2026-12-18', 'Practice term (demonstration)', true
WHERE NOT EXISTS (SELECT 1 FROM school_terms WHERE practice AND label = 'Practice term (demonstration)');

INSERT INTO enrolment (school_id, term_id, class, sex, learners)
SELECT e.school_id, p.id, e.class, e.sex, e.learners
FROM enrolment e
JOIN school_terms t ON t.id = e.term_id AND t.year = 2026 AND t.term = 3
CROSS JOIN (SELECT id FROM school_terms WHERE practice AND label = 'Practice term (demonstration)') p
ON CONFLICT (school_id, term_id, class, sex) DO NOTHING;

COMMIT;
