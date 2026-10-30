import { describe, expect, it } from 'vitest';

import { isValidGtin, normalizeGtin } from './gtin.js';

describe('isValidGtin', () => {
  it('accepts valid GTIN-8, -12, -13 and -14', () => {
    expect(isValidGtin('96385074')).toBe(true);
    expect(isValidGtin('036000291452')).toBe(true);
    expect(isValidGtin('4006381333931')).toBe(true);
    expect(isValidGtin('9780306406157')).toBe(true);
    expect(isValidGtin('10614141000415')).toBe(true);
  });

  it('rejects wrong check digits, lengths and characters', () => {
    expect(isValidGtin('4006381333932')).toBe(false);
    expect(isValidGtin('400638133393')).toBe(false);
    expect(isValidGtin('ABCDEFGHIJKLM')).toBe(false);
    expect(isValidGtin('')).toBe(false);
  });

  it('normalizes spaces and hyphens', () => {
    expect(normalizeGtin('4006 381-333931')).toBe('4006381333931');
    expect(isValidGtin('4006 381 333 931')).toBe(true);
  });
});
