import { useCallback, useState } from 'react';

const KEY = 'lishe.chosenTerm';

/** The term an officer last picked, or '' (the server's current term). */
export function readChosenTerm(storage = globalThis.sessionStorage) {
  try {
    return storage?.getItem(KEY) || '';
  } catch {
    return '';
  }
}

export function saveChosenTerm(termId, storage = globalThis.sessionStorage) {
  try {
    if (termId) storage?.setItem(KEY, termId);
    else storage?.removeItem(KEY);
  } catch {
    // Storage can be blocked; the choice then lasts only on this page
  }
}

/**
 * Whether a request failed because the chosen term no longer exists (deleted from the
 * calendar, or a rebuilt demo database with new ids). The page then drops the choice and
 * shows the current term, instead of an error with no term picker to escape it.
 */
export function chosenTermGone(error, termId) {
  return Boolean(termId) && error?.status === 404 && /term/i.test(error?.message || '');
}

/**
 * The term picked on one officer page (Analytics, a school, enrolment checks) carries to
 * the others for the rest of the browser session, so moving between them keeps the term.
 * '' means the server's current term.
 */
export function useChosenTerm() {
  const [termId, setTermId] = useState(readChosenTerm);
  const choose = useCallback((next) => {
    saveChosenTerm(next);
    setTermId(next);
  }, []);
  return [termId, choose];
}
