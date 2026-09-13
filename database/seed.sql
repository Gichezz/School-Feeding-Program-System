-- Seed data for the single-school prototype.
-- Run after schema.sql. Replace passwords/IDs as needed in later phases.

INSERT INTO schools (id, name, location, version)
VALUES (
    '11111111-1111-1111-1111-111111111111',
    'Demo Primary School',
    'Sample District',
    1
)
ON CONFLICT (id) DO NOTHING;

INSERT INTO students (id, school_id, student_code, full_name, grade, version)
VALUES
    (
        '22222222-2222-2222-2222-222222222201',
        '11111111-1111-1111-1111-111111111111',
        'S001',
        'Amina Okello',
        'P4',
        1
    ),
    (
        '22222222-2222-2222-2222-222222222202',
        '11111111-1111-1111-1111-111111111111',
        'S002',
        'Brian Njoroge',
        'P4',
        1
    ),
    (
        '22222222-2222-2222-2222-222222222203',
        '11111111-1111-1111-1111-111111111111',
        'S003',
        'Catherine Wanjiku',
        'P5',
        1
    )
ON CONFLICT (school_id, student_code) DO NOTHING;
