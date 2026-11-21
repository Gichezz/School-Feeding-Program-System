import { describe, expect, it } from 'vitest';
import { splitQueue } from './queueParts';

describe('splitQueue', () => {
  it('puts waiting work first and keeps the given order inside each part', () => {
    const items = [
      { key: 'devices', done: true },
      { key: 'locked', done: true },
      { key: 'passkey' },
      { key: 'terms' },
    ];
    const { open, done } = splitQueue(items);
    expect(open.map((i) => i.key)).toEqual(['passkey', 'terms']);
    expect(done.map((i) => i.key)).toEqual(['devices', 'locked']);
  });
});
