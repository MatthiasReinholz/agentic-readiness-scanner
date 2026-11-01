import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { scan } from '../scan.js';
import { fixtureFetcher } from '../testing/index.js';
import { countSkips, groupIsOptional, prioritize, tierOf } from './priorities.js';

const fixture = (name: string) =>
  join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..', 'fixtures', 'stores', name);

describe('prioritize', () => {
  it('maps weights to tiers', () => {
    expect(tierOf(3)).toBe('blocking');
    expect(tierOf(2)).toBe('expected');
    expect(tierOf(1)).toBe('nice_to_have');
    expect(tierOf('info')).toBe('informational');
  });

  it('puts the next gate first, then blocking, expected and nice-to-have findings', async () => {
    const result = await scan('https://boots.example/', {
      fetcher: fixtureFetcher(fixture('shopify-store')),
    });
    const priorities = prioritize(result);
    const open = result.results.filter((r) => r.verdict === 'fail' || r.verdict === 'warn');
    const listed = [
      ...priorities.first,
      ...priorities.next,
      ...priorities.optional,
      ...priorities.informational,
    ];
    expect(listed.map((p) => p.result.id).sort()).toEqual(open.map((r) => r.id).sort());
    // Every next-gate finding leads, tagged with the level it unlocks.
    const gateIds = result.level.next_gate.filter((id) => open.some((r) => r.id === id));
    expect(priorities.first.slice(0, gateIds.length).map((p) => p.result.id)).toEqual(
      expect.arrayContaining(gateIds),
    );
    for (const priority of priorities.first.slice(0, gateIds.length))
      expect(priority.unlocks).toBe(result.level.value + 1);
    // Nothing nice to have appears before something blocking unless it is a gate.
    for (const priority of priorities.first.slice(gateIds.length))
      expect(priority.tier).toBe('blocking');
    for (const priority of priorities.next) expect(priority.tier).toBe('expected');
    for (const priority of priorities.optional) expect(priority.tier).toBe('nice_to_have');
    // Within a tier, fail comes before warn.
    const verdicts = priorities.optional.map((p) => p.result.verdict);
    expect(
      !verdicts.includes('warn') || verdicts.lastIndexOf('fail') < verdicts.indexOf('warn'),
    ).toBe(true);
    const counted = Object.values(priorities.counts).reduce((a, b) => a + b, 0);
    expect(counted).toBe(open.length);
  });

  it('reports nothing to fix for a store that passes everything that applies', async () => {
    const result = await scan('https://ceramics.example/', {
      fetcher: fixtureFetcher(fixture('good-woocommerce')),
    });
    const priorities = prioritize(result);
    expect(priorities.first).toEqual([]);
    expect(priorities.next).toEqual([]);
    expect(priorities.counts.blocking).toBe(0);
  });

  it('splits skips into did-not-apply and could-not-run, and flags optional groups', async () => {
    const result = await scan('https://blog.example/', {
      fetcher: fixtureFetcher(fixture('content-site')),
    });
    const skips = countSkips(result);
    expect(skips.not_applicable).toBeGreaterThan(0);
    expect(skips.not_applicable + skips.unanswered).toBe(
      result.results.filter((r) => r.verdict === 'skip').length,
    );
    expect(groupIsOptional(result.results.filter((r) => r.group === 'A4'))).toBe(true);
    expect(groupIsOptional(result.results.filter((r) => r.group === 'A2'))).toBe(false);
  });
});
