import { describe, expect, it } from 'vitest';
import { readChosenTerm, saveChosenTerm } from './useChosenTerm';

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
