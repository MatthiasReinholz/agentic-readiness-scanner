import { describe, expect, it } from 'vitest';

import { hasPriceText } from './a3/index.js';
import { hasPostalAddressText, hasShippingDetails } from './b4/index.js';

/**
 * The timing bounds below guard against super-linear backtracking (which takes seconds
 * to minutes on these inputs), not against slowness, so they are generous on purpose.
 */
function timed(fn: () => boolean): { value: boolean; ms: number } {
  const started = performance.now();
  const value = fn();
  return { value, ms: performance.now() - started };
}

describe('price text pattern', () => {
  it('recognises common price formats', () => {
    for (const sample of [
      '€ 1.234,56',
      '$12.99',
      '1 299 kr is not matched but 1299 SEK is',
      'Price: 49,90 EUR',
      'CHF 5',
    ]) {
      expect(hasPriceText(sample)).toBe(true);
    }
    expect(hasPriceText('no numbers here')).toBe(false);
    expect(hasPriceText('page 12 of 40')).toBe(false);
  });

  it('stays linear on hostile numeric input', () => {
    const hostile = `${'1'.repeat(200_000)} ${'1,'.repeat(100_000)}`;
    const { ms } = timed(() => hasPriceText(hostile));
    expect(ms).toBeLessThan(3000);
  });
});

describe('shipping details pattern', () => {
  it('recognises amounts, delivery times and keywords', () => {
    expect(hasShippingDetails('Versand 4,90 € innerhalb Deutschlands')).toBe(true);
    expect(hasShippingDetails('Delivery in 2-4 business days')).toBe(true);
    expect(hasShippingDetails('Lieferzeit: 3 bis 5 Werktage')).toBe(true);
    expect(hasShippingDetails('We ship worldwide')).toBe(true);
    expect(hasShippingDetails('Our story began in 1998 with a small shop')).toBe(false);
  });

  it('stays linear on hostile numeric input', () => {
    const hostile = `${'9'.repeat(200_000)} ${'12 '.repeat(50_000)}`;
    const { ms } = timed(() => hasShippingDetails(hostile));
    expect(ms).toBeLessThan(3000);
  });
});

describe('postal address pattern', () => {
  it('recognises a postal code with a place and a street with a house number', () => {
    expect(hasPostalAddressText('Example Ceramics GmbH, Töpferstraße 12, 10115 Berlin')).toEqual({
      postal_code: true,
      street: true,
    });
    expect(hasPostalAddressText('123 Main St., Springfield, 62701 IL')).toMatchObject({
      postal_code: true,
    });
    expect(hasPostalAddressText('Main Street 5')).toEqual({ postal_code: false, street: true });
    // Two letters before a number are not a street: "in 2001", "St. 5".
    expect(hasPostalAddressText('Main St. 5')).toEqual({ postal_code: false, street: false });
    expect(hasPostalAddressText('Call us any time.')).toEqual({
      postal_code: false,
      street: false,
    });
  });

  it('stays linear on hostile input', () => {
    const hostile = `${'a'.repeat(200_000)} ${'1234 '.repeat(50_000)}${'b'.repeat(100_000)}`;
    const { ms } = timed(() => hasPostalAddressText(hostile).street);
    expect(ms).toBeLessThan(3000);
  });
});
