import { describe, expect, it } from 'vitest';
import { carriedForward } from './enrolmentCarry';

const CLASSES = ['PP1', 'PP2', 'Grade 1', 'Grade 2', 'Grade 3', 'Grade 4', 'Grade 5', 'Grade 6', 'Grade 7', 'Grade 8', 'Grade 9'];
const SEXES = ['F', 'M'];
const terms = [
  { id: 't1', year: 2026, term: 1, opensOn: '05-01-2026' },
  { id: 't2', year: 2026, term: 2, opensOn: '27-04-2026' },
  { id: 't3', year: 2026, term: 3, opensOn: '24-08-2026' },
  { id: 'n1', year: 2027, term: 1, opensOn: '04-01-2027' },
];
const t2 = [
  { termId: 't2', class: 'PP1', sex: 'F', learners: 30 },
  { termId: 't2', class: 'PP2', sex: 'F', learners: 28 },
  { termId: 't2', class: 'Grade 1', sex: 'M', learners: 41 },
  { termId: 't2', class: 'Grade 9', sex: 'M', learners: 55 },
];
const carry = (termId, enrolment) => carriedForward({ terms, enrolment, termId, classes: CLASSES, sexes: SEXES });

describe('carriedForward', () => {
  it('copies the classes as they were within a school year', () => {
    expect(carry('t3', t2)).toEqual({
      fromTerm: terms[1],
      promoted: false,
      values: { 'PP1|F': 30, 'PP2|F': 28, 'Grade 1|M': 41, 'Grade 9|M': 55 },
    });
  });

  it('moves every learner up a class into a new school year, leaving PP1 for new admissions', () => {
    const t3 = t2.map((e) => ({ ...e, termId: 't3' }));
    const result = carry('n1', t3);

    expect(result.promoted).toBe(true);
    // PP2 comes from last year's PP1, Grade 1 from PP2, Grade 2 from Grade 1; last year's Grade 9 has left
    expect(result.values).toEqual({ 'PP2|F': 30, 'Grade 1|F': 28, 'Grade 2|M': 41 });
  });

  it('uses the most recent earlier term that has enrolment', () => {
    expect(carry('n1', t2).fromTerm.id).toBe('t2');
  });

  it('does nothing for a term that already has enrolment, or with nothing earlier', () => {
    expect(carry('t2', t2)).toBeNull();
    expect(carry('t1', t2)).toBeNull();
  });
});
