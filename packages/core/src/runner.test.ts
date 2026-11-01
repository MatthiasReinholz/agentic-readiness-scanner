import { catalog } from '@agentic-readiness/catalog';
import { describe, expect, it } from 'vitest';

import { defineCheck, fail, pass, skip, type Check } from './checks/types.js';
import { BudgetExhaustedError } from './http/types.js';
import { builtInChecks } from './checks/registry.js';
import { runChecks } from './runner.js';
import { defined, mapFetcher, targetFor } from './testing/index.js';

async function run(checks: readonly Check[], options: Parameters<typeof targetFor>[0] = {}) {
  const { results, outcomes } = await runChecks({
    target: targetFor(options),
    fetcher: mapFetcher({}),
    checks,
  });
  const byId = new Map(results.map((result) => [result.id, result]));
  return { results, outcomes, result: (id: string) => defined(byId.get(id), id) };
}

describe('runChecks', () => {
  it('reports every catalog check once, in catalog order, as not_implemented when nothing implements it', async () => {
    const { results, result } = await run([]);
    expect(results.map((item) => item.id)).toEqual(catalog.checks.map((item) => item.id));
    expect(result('A1.1')).toMatchObject({
      verdict: 'skip',
      skip_reason: 'not_implemented',
      applies: true,
    });
    expect(result('A1.1').fix).toBeUndefined();
  });

  it('skips dependents when the parent failed or was skipped, naming the parent', async () => {
    const { result } = await run([
      defineCheck('A1.2', () => fail('no sitemap')),
      defineCheck('A1.3', () => pass('never runs')),
      defineCheck('A1.6', () => pass('never runs either')),
    ]);
    expect(result('A1.3')).toMatchObject({
      verdict: 'skip',
      skip_reason: 'dependency_failed',
      applies: true,
      evidence: { dependency: 'A1.2' },
    });
    // A1.5 is not implemented here, so its skip blocks A1.6 the same way a failure would.
    expect(result('A1.6')).toMatchObject({
      skip_reason: 'dependency_failed',
      evidence: { dependency: 'A1.5' },
    });
  });

  it('turns a thrown error into a skip with reason error and keeps going', async () => {
    const { result } = await run([
      defineCheck('A1.1', () => {
        throw new TypeError('boom');
      }),
      defineCheck('A1.2', () => pass('still runs')),
    ]);
    expect(result('A1.1')).toMatchObject({
      verdict: 'skip',
      skip_reason: 'error',
      message: 'TypeError: boom',
      applies: true,
    });
    expect(result('A1.2').verdict).toBe('pass');
  });

  it('marks the exhausting check and every later implemented check as budget_exhausted', async () => {
    let laterRan = false;
    const { result } = await run([
      defineCheck('A1.1', () => {
        throw new BudgetExhaustedError(3);
      }),
      defineCheck('A1.2', () => {
        laterRan = true;
        return pass('ran');
      }),
    ]);
    expect(result('A1.1')).toMatchObject({
      skip_reason: 'budget_exhausted',
      message: 'Request budget of 3 exhausted',
    });
    expect(result('A1.2')).toMatchObject({ verdict: 'skip', skip_reason: 'budget_exhausted' });
    expect(laterRan).toBe(false);
  });

  it('sets applies to false only for not_applicable, from the runner or from the check', async () => {
    const content = await run(
      [defineCheck('A1.1', () => skip('not_applicable', 'nothing to look at'))],
      { platform: 'wordpress' },
    );
    expect(content.result('A1.1')).toMatchObject({ skip_reason: 'not_applicable', applies: false });
    // Commerce checks are outside the content-site profile.
    expect(content.result('B2.1')).toMatchObject({ skip_reason: 'not_applicable', applies: false });
    // Platform requirement: Store API checks need WooCommerce even in a store profile.
    const shopify = await run([], { platform: 'shopify' });
    expect(shopify.result('B1.2')).toMatchObject({ skip_reason: 'not_applicable', applies: false });
    // Target-shape requirement: product-page checks need sampled product pages.
    expect(shopify.result('B2.1')).toMatchObject({
      skip_reason: 'not_applicable',
      applies: false,
      message: 'no product pages were found to sample',
    });
    const withProducts = await run([], {
      platform: 'shopify',
      products: ['https://shop.example/products/a'],
    });
    expect(withProducts.result('B2.1')).toMatchObject({
      skip_reason: 'not_implemented',
      applies: true,
    });
  });

  it('attaches the fix only to warn and fail verdicts and exposes outcomes by id', async () => {
    const { result, outcomes } = await run([
      defineCheck('A1.1', () => fail('no robots')),
      defineCheck('A1.2', () => pass('ok')),
    ]);
    expect(result('A1.1').fix).toBeDefined();
    expect(result('A1.2').fix).toBeUndefined();
    expect(outcomes.get('A1.2')?.verdict).toBe('pass');
  });
});

describe('runChecks on a refused home page', () => {
  it('evaluates only robots.txt, the sitemap and the refusal, and skips the rest', async () => {
    const target = { ...targetFor(), blocked: { status: 403, vendor: 'Akamai', challenge: false } };
    const { results } = await runChecks({ target, fetcher: mapFetcher({}), checks: builtInChecks });
    const byId = new Map(results.map((r) => [r.id, r]));
    expect(byId.get('A1.1')?.skip_reason).not.toBe('dependency_failed');
    const skipped = byId.get('B2.1');
    expect(skipped?.verdict).toBe('skip');
    expect(skipped?.skip_reason).toBe('dependency_failed');
    expect(skipped?.message).toMatch(/home page refused the scanner \(HTTP 403\); see A2.4/);
    expect(byId.get('A3.2')?.message).toMatch(/see A2.4/);
  });
});
