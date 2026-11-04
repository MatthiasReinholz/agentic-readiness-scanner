import { describe, expect, it } from 'vitest';

import { sample } from './sampling.js';

describe('stable sampling', () => {
  const store = Array.from({ length: 200 }, (_, i) => `https://shop.example/products/item-${i}`);

  it('changes at most one sampled page when one product is added or removed', () => {
    const before = sample(store, 'shop.example', 3);
    for (const added of ['https://shop.example/products/new', 'https://shop.example/products/zz']) {
      const after = sample([...store, added], 'shop.example', 3);
      expect(after.filter((url) => !before.includes(url)).length).toBeLessThanOrEqual(1);
    }
    const removed = sample(
      store.filter((url) => url !== before[0]),
      'shop.example',
      3,
    );
    expect(removed.filter((url) => before.includes(url))).toEqual(before.slice(1));
  });

  it('ranks each URL on its own, so the sample does not depend on the other URLs', () => {
    const picked = sample(store, 'shop.example', 2);
    const subset = [...picked, ...store.slice(0, 20)];
    expect(sample(subset, 'shop.example', 2)).toEqual(picked);
  });

  it('spreads its picks instead of favouring the start or end of the list', () => {
    const picks = new Set<string>();
    for (let index = 0; index < 50; index += 1) {
      for (const url of sample(store, `store-${index}.example`, 1)) picks.add(url);
    }
    expect(picks.size).toBeGreaterThan(35);
  });
});
