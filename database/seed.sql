-- Minimal development/demo data for the single-school prototype.
-- Run after schema.sql.
--
-- Demo passwords are stored only as bcrypt hashes (never plain text).
-- Corresponding development passwords (local use only):
--   admin@demo-school.local        -> ChangeMeAdmin1
--   staff@demo-school.local        -> ChangeMeStaff1
--
-- LOCAL USE ONLY: these passwords are published here, so never load this file on a
-- hosted or shared deployment. Create the first administrator there with
-- backend/scripts/create-admin.js and add other users from Settings → Users.

INSERT INTO schools (id, name, location)
VALUES (
    '11111111-1111-1111-1111-111111111111',
    'Demo Primary School',
    'Sample District'
)
ON CONFLICT (id) DO NOTHING;

-- The staff account belongs to the demo school. School staff sign in on an enrolled
-- school device: set one up from the sign-in page with this email and password.
INSERT INTO users (id, name, email, password_hash, role, school_id)
VALUES (
    'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1',
    'Programme Administrator',
    'admin@demo-school.local',
    '$2b$10$rZctUe0na2ulC9Q5fctLIOv/e7K4SfuK71N22.QxTPxctjN3WlYWy',
    'admin',
    NULL
),
(
    'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa2',
    'School Feeding Officer',
    'staff@demo-school.local',
    '$2b$10$31do6hB2ak7TOWnW21zOPOjemDOboT9uLb.W/c/Jrkmq8zJRJC73a',
    'school_staff',
    '11111111-1111-1111-1111-111111111111'
)
ON CONFLICT (email) DO NOTHING;

INSERT INTO students (id, school_id, student_code, full_name, grade)
VALUES
    (
        '22222222-2222-2222-2222-222222222201',
        '11111111-1111-1111-1111-111111111111',
        'S001',
        'Amina Okello',
        'P4'
    ),
    (
        '22222222-2222-2222-2222-222222222202',
        '11111111-1111-1111-1111-111111111111',
        'S002',
        'Brian Njoroge',
        'P4'
    ),
    (
        '22222222-2222-2222-2222-222222222203',
        '11111111-1111-1111-1111-111111111111',
        'S003',
        'Catherine Wanjiku',
        'P5'
    )
ON CONFLICT (school_id, student_code) DO NOTHING;

INSERT INTO attendance_records (
    id,
    school_id,
    attendance_date,
    total_registered,
    total_present,
    total_absent,
    version,
    updated_by,
    client_id
)
VALUES (
    '33333333-3333-3333-3333-333333333301',
    '11111111-1111-1111-1111-111111111111',
    DATE '2026-09-11',
    3,
    2,
    1,
    1,
    'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa2',
    'seed-device-01'
)
ON CONFLICT (school_id, attendance_date) DO NOTHING;

INSERT INTO meal_distributions (
    id,
    school_id,
    distribution_date,
    meals_prepared,
    meals_served,
    version,
    updated_by,
    client_id
)
VALUES (
    '44444444-4444-4444-4444-444444444401',
    '11111111-1111-1111-1111-111111111111',
    DATE '2026-09-11',
    3,
    2,
    1,
    'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa2',
    'seed-device-01'
)
ON CONFLICT (school_id, distribution_date) DO NOTHING;
