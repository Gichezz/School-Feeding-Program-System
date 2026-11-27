import { describe, expect, it } from 'vitest';
import { chosenTermGone, readChosenTerm, saveChosenTerm } from './useChosenTerm';

describe('chosenTermGone', () => {
  const notFound = (message) => Object.assign(new Error(message), { status: 404 });

  it('is true only when a chosen term no longer exists', () => {
    expect(chosenTermGone(notFound('Term not found'), 'old-term-id')).toBe(true);
    // The current term was asked for, so there is no choice to drop
    expect(chosenTermGone(notFound('Term not found'), '')).toBe(false);
    expect(chosenTermGone(notFound('School not found'), 'old-term-id')).toBe(false);
    expect(chosenTermGone(Object.assign(new Error('Server error'), { status: 500 }), 'old-term-id')).toBe(false);
  });
});

function memoryStorage() {
  const values = new Map();
  return {
    getItem: (k) => (values.has(k) ? values.get(k) : null),
    setItem: (k, v) => values.set(k, String(v)),
    removeItem: (k) => values.delete(k),
  };
}

describe('the term an officer picked', () => {
  it('is kept for the session and cleared back to the current term', () => {
    const storage = memoryStorage();
    expect(readChosenTerm(storage)).toBe('');
    saveChosenTerm('term-3-2026', storage);
    expect(readChosenTerm(storage)).toBe('term-3-2026');
    saveChosenTerm('', storage);
    expect(readChosenTerm(storage)).toBe('');
  });

  it('falls back to the current term when storage is blocked', () => {
    const blocked = { getItem: () => { throw new Error('blocked'); }, setItem: () => { throw new Error('blocked'); } };
    expect(readChosenTerm(blocked)).toBe('');
    expect(() => saveChosenTerm('x', blocked)).not.toThrow();
  });
});
