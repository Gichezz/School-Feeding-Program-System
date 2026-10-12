import { describe, expect, it } from 'vitest';
import {
  formatNumber,
  formatPercent,
  formatShare,
  formatDelta,
  formatDate,
  formatDateTime,
  formatRelativeTime,
  toInputDate,
  fromInputDate,
} from './format';

describe('numbers', () => {
  it('adds thousands separators and rounds', () => {
    expect(formatNumber(4786)).toBe('4,786');
    expect(formatNumber(1234567.6)).toBe('1,234,568');
    expect(formatNumber('532')).toBe('532');
  });

  it('formats percentages to one decimal place', () => {
    expect(formatPercent(0.915)).toBe('91.5%');
    expect(formatPercent(1)).toBe('100.0%');
    expect(formatPercent(91.5, { isRatio: false })).toBe('91.5%');
    expect(formatShare(93, 100)).toBe('93.0%');
    expect(formatShare(5, 0)).toBe('–');
  });

  it('signs deltas with a true minus sign', () => {
    expect(formatDelta(12)).toBe('+12');
    expect(formatDelta(-1500)).toBe('−1,500');
    expect(formatDelta(0)).toBe('0');
  });

  it('shows a dash for missing values', () => {
    expect(formatNumber(null)).toBe('–');
    expect(formatNumber(undefined)).toBe('–');
    expect(formatPercent('abc')).toBe('–');
  });
});

describe('dates', () => {
  it('formats every supported input as DD-MM-YYYY', () => {
    expect(formatDate('2026-10-09')).toBe('09-10-2026');
    expect(formatDate('09-10-2026')).toBe('09-10-2026');
    expect(formatDate(new Date(2026, 9, 9, 23, 30))).toBe('09-10-2026');
    expect(formatDate('not a date')).toBe('–');
  });

  it('does not shift calendar dates across time zones', () => {
    expect(formatDate('2026-01-01')).toBe('01-01-2026');
  });

  it('formats date and time in 24-hour form', () => {
    expect(formatDateTime(new Date(2026, 9, 11, 7, 5))).toBe('11-10-2026 07:05');
  });

  it('describes recent times relative to now', () => {
    const now = new Date(2026, 9, 12, 12, 0).getTime();
    expect(formatRelativeTime(new Date(now - 20 * 1000), now)).toBe('just now');
    expect(formatRelativeTime(new Date(now - 5 * 60 * 1000), now)).toBe('5 min ago');
    expect(formatRelativeTime(new Date(now - 3 * 60 * 60 * 1000), now)).toBe('3 h ago');
    expect(formatRelativeTime(new Date(now - 24 * 60 * 60 * 1000), now)).toBe('yesterday');
    expect(formatRelativeTime(new Date(now - 3 * 24 * 60 * 60 * 1000), now)).toBe('3 days ago');
    expect(formatRelativeTime(new Date(2026, 8, 1), now)).toBe('01-09-2026');
  });

  it('converts between DD-MM-YYYY and date input values', () => {
    expect(toInputDate('09-10-2026')).toBe('2026-10-09');
    expect(fromInputDate('2026-10-09')).toBe('09-10-2026');
    expect(toInputDate('')).toBe('');
  });
});
