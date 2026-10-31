import { describe, expect, it } from 'vitest';

import { fnv1a32, mulberry32, sample, seededShuffle } from './sampling.js';

const urls = Array.from({ length: 20 }, (_, i) => `https://shop.example/product/p${i}/`);

describe('deterministic sampling', () => {
  it('hashes with FNV-1a 32 reference values', () => {
    expect(fnv1a32('')).toBe(0x811c9dc5);
    expect(fnv1a32('a')).toBe(0xe40c292c);
    expect(fnv1a32('foobar')).toBe(0xbf9cf968);
  });

  it('yields numbers in [0, 1) that repeat for the same seed', () => {
    const a = mulberry32(42);
    const b = mulberry32(42);
    const first = Array.from({ length: 5 }, () => a());
    expect(Array.from({ length: 5 }, () => b())).toEqual(first);
    expect(first.every((n) => n >= 0 && n < 1)).toBe(true);
  });

  it('samples the same pages for the same hostname and different ones for another', () => {
    const once = sample(urls, 'ceramics.example', 3);
    expect(sample(urls, 'ceramics.example', 3)).toEqual(once);
    expect(once).toHaveLength(3);
    expect(sample(urls, 'pottery.example', 3)).not.toEqual(once);
    expect(seededShuffle(urls, 'x')).not.toEqual(urls);
  });

  it('ignores input order and duplicates, and never returns more than it was given', () => {
    const shuffled = [...urls].reverse();
    expect(sample(shuffled, 'ceramics.example', 3)).toEqual(sample(urls, 'ceramics.example', 3));
    expect(sample([...urls, ...urls], 'ceramics.example', 25)).toHaveLength(urls.length);
    expect(sample(urls, 'ceramics.example', 0)).toEqual([]);
    expect(sample([], 'ceramics.example', 2)).toEqual([]);
    expect(sample(['only'], 'ceramics.example', 2)).toEqual(['only']);
  });
});
