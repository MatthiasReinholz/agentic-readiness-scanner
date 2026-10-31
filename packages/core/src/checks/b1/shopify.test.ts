import { getCheck, type CheckDefinition } from '@agentic-readiness/catalog';
import { describe, expect, it } from 'vitest';

import type { Fetcher } from '../../http/types.js';
import type { Target } from '../../target/types.js';
import { mapFetcher, targetFor, type MapResponse } from '../../testing/index.js';
import type { CheckOutcome } from '../types.js';
import { shopifyProductsJsonReadable } from './shopify.js';

/** Runs the check with its catalog entry, or a stand-in until that entry lands. */
function run(target: Target, fetcher: Fetcher): Promise<CheckOutcome> {
  const id = shopifyProductsJsonReadable.id;
  const definition: CheckDefinition = getCheck(id) ?? {
    id,
    group: 'B1',
    title: id,
    question: id,
    method: id,
    weight: 2,
    requires: [],
    depends_on: [],
    spec: [{ title: 'placeholder', url: 'https://example.com/spec' }],
    fix: { summary: 'placeholder', agent_prompt: 'placeholder', auto_fix: false },
  };
  return shopifyProductsJsonReadable.run({ target, fetcher, definition, outcomes: new Map() });
}

const url = 'https://shop.example/products.json?limit=5';
const shopify = () => targetFor({ platform: 'shopify' });
const answer = (response?: MapResponse) =>
  run(shopify(), mapFetcher(response === undefined ? {} : { [url]: response }));

describe('B1.8 Shopify products.json readable', () => {
  it('skips as not applicable when the platform is not Shopify', async () => {
    const outcome = await run(targetFor(), mapFetcher({ [url]: '{"products":[]}' }));
    expect(outcome.verdict).toBe('skip');
    expect(outcome.skipReason).toBe('not_applicable');
  });

  it('passes on a JSON products array and records count and handles', async () => {
    const outcome = await answer({
      status: 200,
      headers: { 'content-type': 'application/json; charset=utf-8' },
      body: JSON.stringify({
        products: [
          { id: 1, handle: 'trail-boot' },
          { id: 2, handle: 'canvas-sneaker' },
        ],
      }),
    });
    expect(outcome.verdict).toBe('pass');
    expect(outcome.message).toBe('products.json lists 2 product(s) without credentials');
    expect(outcome.evidence).toEqual({
      url,
      status: 200,
      content_type: 'application/json',
      count: 2,
      handles: ['trail-boot', 'canvas-sneaker'],
    });
  });

  it('fails on 401 naming password protection', async () => {
    const outcome = await answer({ status: 401, body: '' });
    expect(outcome.verdict).toBe('fail');
    expect(outcome.message).toMatch(/HTTP 401.*password-protected/);
    expect(outcome.evidence).toMatchObject({ status: 401 });
  });

  it('fails on 404 naming disabled endpoints', async () => {
    const outcome = await answer();
    expect(outcome.verdict).toBe('fail');
    expect(outcome.message).toMatch(/HTTP 404.*JSON endpoints are disabled/);
  });

  it('fails on the storefront password page', async () => {
    const form = await answer(
      '<!doctype html><html><head><title>Example Boots</title></head><body><form action="/password" method="post"><input type="password" name="password" /></form></body></html>',
    );
    expect(form.verdict).toBe('fail');
    expect(form.message).toMatch(/password page/);
    expect(form.evidence).toMatchObject({ password_page: true, title: 'Example Boots' });
    const soon = await answer(
      '<!doctype html><html><head><title>Opening Soon – Example Boots</title></head><body><p>Be right back.</p></body></html>',
    );
    expect(soon.verdict).toBe('fail');
    expect(soon.message).toMatch(/password page/);
  });

  it('fails on another HTML page, a non-JSON body, JSON without products and other statuses', async () => {
    const html = await answer('<html><head><title>Home</title></head><body>Shop</body></html>');
    expect(html.verdict).toBe('fail');
    expect(html.message).toMatch(/HTML page \(HTTP 200\) instead of JSON/);
    const text = await answer('Checking your browser...');
    expect(text.verdict).toBe('fail');
    expect(text.message).toMatch(/non-JSON body/);
    const shape = await answer('{"items":[]}');
    expect(shape.verdict).toBe('fail');
    expect(shape.message).toBe('products.json returned JSON without a products array');
    const down = await answer({ status: 503, body: '' });
    expect(down.verdict).toBe('fail');
    expect(down.message).toBe('products.json returned HTTP 503');
  });
});
