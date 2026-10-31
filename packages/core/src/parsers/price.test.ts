import { describe, expect, it } from 'vitest';

import { amountVisible, hasPriceText, parseAmount, pricesInText } from './price.js';

describe('parseAmount', () => {
  it('normalises European and English separators to a number', () => {
    expect(parseAmount('1.234,56')).toBe(1234.56);
    expect(parseAmount('1,234.56')).toBe(1234.56);
    expect(parseAmount('24.00')).toBe(24);
    expect(parseAmount('24,00')).toBe(24);
    expect(parseAmount('1.234')).toBe(1234);
    expect(parseAmount('12.5')).toBe(12.5);
    expect(parseAmount('1234.50')).toBe(1234.5);
    expect(parseAmount('12.345.678')).toBe(12_345_678);
  });

  it('ignores a currency marker around the amount', () => {
    expect(parseAmount('24.00 EUR')).toBe(24);
    expect(parseAmount('€ 24,00')).toBe(24);
    expect(parseAmount('$1,299.99')).toBe(1299.99);
  });

  it('returns null for anything that is not one amount', () => {
    expect(parseAmount(null)).toBeNull();
    expect(parseAmount('')).toBeNull();
    expect(parseAmount('free')).toBeNull();
    expect(parseAmount('1 234,56')).toBeNull();
    expect(parseAmount('24.00 to 48.00')).toBeNull();
  });
});

describe('pricesInText', () => {
  it('collects every amount next to a currency marker, once each, in order', () => {
    expect(pricesInText('Was €48.00, now €24.00. Shipping 4,90 EUR. Also €24.00 again.')).toEqual([
      48, 24, 4.9,
    ]);
  });

  it('ignores numbers without a currency marker', () => {
    expect(pricesInText('Holds 350 ml, 28 cm wide, page 12 of 40')).toEqual([]);
  });

  it('stays linear on hostile numeric input', () => {
    const hostile = `${'1'.repeat(200_000)} ${'1,'.repeat(100_000)}`;
    const started = performance.now();
    pricesInText(hostile);
    expect(performance.now() - started).toBeLessThan(3000);
  });

  it('keeps hasPriceText behaviour', () => {
    expect(hasPriceText('CHF 5')).toBe(true);
    expect(hasPriceText('no numbers here')).toBe(false);
  });
});

describe('amountVisible', () => {
  it('matches within a cent', () => {
    expect(amountVisible(24, [23.99, 48])).toBe(true);
    expect(amountVisible(24, [24.02, 48])).toBe(false);
    expect(amountVisible(24, [])).toBe(false);
  });
});
