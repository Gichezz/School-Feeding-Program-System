import { dayKey } from './planning';

/**
 * Enrolment carried forward to a term that has none yet, so staff check the numbers
 * against the admission register instead of typing every class again.
 *
 * The source is the school's most recent earlier term with enrolment. Within a school
 * year the classes stay as they were. Into a new school year every learner moves up a
 * class: PP1 becomes PP2, ..., Grade 8 becomes Grade 9; Grade 9 leaves the school, and
 * PP1 is left empty for the new admissions.
 *
 * Returns null when the term already has enrolment or there is nothing earlier, else
 * { fromTerm, promoted, values: { "class|sex": learners } }.
 */
export function carriedForward({ terms, enrolment, termId, classes, sexes }) {
  if (enrolment.some((e) => e.termId === termId)) return null;
  const term = terms.find((t) => t.id === termId);
  if (!term) return null;
  const earlier = terms
    .filter((t) => dayKey(t.opensOn) < dayKey(term.opensOn))
    .sort((a, b) => dayKey(b.opensOn).localeCompare(dayKey(a.opensOn)));
  const fromTerm = earlier.find((t) => enrolment.some((e) => e.termId === t.id));
  if (!fromTerm) return null;

  const promoted = fromTerm.year !== term.year;
  const source = Object.fromEntries(enrolment.filter((e) => e.termId === fromTerm.id).map((e) => [`${e.class}|${e.sex}`, e.learners]));
  const values = {};
  classes.forEach((schoolClass, i) => {
    // Promoted: this class's learners were in the class below last year; PP1 is new
    const from = promoted ? classes[i - 1] : schoolClass;
    for (const sex of sexes) {
      const learners = from ? source[`${from}|${sex}`] : undefined;
      if (learners !== undefined) values[`${schoolClass}|${sex}`] = learners;
    }
  });
  return { fromTerm, promoted, values };
}
