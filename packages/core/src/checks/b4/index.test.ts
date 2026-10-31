import { describe, expect, it } from 'vitest';

import { mapFetcher, runCheck, targetFor } from '../../testing/index.js';
import {
  privacyAndTermsFound,
  returnPolicyFound,
  securityTxt,
  shippingPolicyFound,
} from './index.js';

function pageOf(words: number, extra = ''): string {
  const text = Array.from({ length: words }, (_, i) => `word${i}`).join(' ');
  return `<!doctype html><html><head><title>Policy</title></head><body><main><p>${text}</p>${extra}</main></body></html>`;
}

const returns = 'https://shop.example/returns/';
const shipping = 'https://shop.example/shipping/';

describe('B4.1 return policy', () => {
  it('fails without a link, fails on a 404 page, warns on a short page, passes on a real one', async () => {
    const missing = await runCheck(returnPolicyFound, targetFor(), mapFetcher({}));
    expect(missing.verdict).toBe('fail');
    expect(missing.message).toMatch(/no return or refund policy link/);
    const gone = await runCheck(
      returnPolicyFound,
      targetFor({ policies: { returns } }),
      mapFetcher({}),
    );
    expect(gone.verdict).toBe('fail');
    expect(gone.message).toBe('return policy page returned HTTP 404');
    expect(gone.evidence).toMatchObject({ url: returns, status: 404 });
    const short = await runCheck(
      returnPolicyFound,
      targetFor({ policies: { returns } }),
      mapFetcher({ [returns]: pageOf(40) }),
    );
    expect(short.verdict).toBe('warn');
    // 40 body words plus the title.
    expect(short.evidence).toMatchObject({ status: 200, words: 41 });
    const full = await runCheck(
      returnPolicyFound,
      targetFor({ policies: { returns } }),
      mapFetcher({ [returns]: pageOf(320) }),
    );
    expect(full.verdict).toBe('pass');
  });
});

describe('B4.2 shipping policy', () => {
  it('warns when the page states no costs, regions or times and passes when it does', async () => {
    const vague = await runCheck(
      shippingPolicyFound,
      targetFor({ policies: { shipping } }),
      mapFetcher({ [shipping]: pageOf(50) }),
    );
    expect(vague.verdict).toBe('warn');
    expect(vague.evidence).toMatchObject({ mentions_costs_regions_or_times: false });
    const concrete = await runCheck(
      shippingPolicyFound,
      targetFor({ policies: { shipping } }),
      mapFetcher({ [shipping]: pageOf(50, '<p>Delivery in 2-4 business days, 4,90 €.</p>') }),
    );
    expect(concrete.verdict).toBe('pass');
  });
});

describe('B4.3 privacy policy and terms', () => {
  const privacy = 'https://shop.example/privacy/';
  const terms = 'https://shop.example/terms/';

  it('counts the pages that answer 200', async () => {
    const both = await runCheck(
      privacyAndTermsFound,
      targetFor({ policies: { privacy, terms } }),
      mapFetcher({ [privacy]: pageOf(10), [terms]: pageOf(10) }),
    );
    expect(both.verdict).toBe('pass');
    expect(both.evidence).toMatchObject({ privacy_status: 200, terms_status: 200 });
    const one = await runCheck(
      privacyAndTermsFound,
      targetFor({ policies: { privacy, terms } }),
      mapFetcher({ [privacy]: pageOf(10) }),
    );
    expect(one.verdict).toBe('warn');
    expect(one.evidence).toMatchObject({ terms_status: 404 });
    const none = await runCheck(privacyAndTermsFound, targetFor(), mapFetcher({}));
    expect(none.verdict).toBe('fail');
    expect(none.evidence).toEqual({ privacy: null, terms: null });
  });
});

describe('B4.7 security.txt', () => {
  const url = 'https://shop.example/.well-known/security.txt';
  const run = (body?: string) =>
    runCheck(securityTxt, targetFor(), mapFetcher(body === undefined ? {} : { [url]: body }));
  const future = new Date(Date.now() + 90 * 86_400_000).toISOString();

  it('fails when missing or HTML', async () => {
    expect((await run()).verdict).toBe('fail');
    const html = await run('<!doctype html><html><body>404</body></html>');
    expect(html.verdict).toBe('fail');
    expect(html.message).toBe('no security.txt');
  });

  it('warns without a Contact, without a valid Expires, or when expired', async () => {
    const noContact = await run(`Expires: ${future}\n`);
    expect(noContact.verdict).toBe('warn');
    expect(noContact.message).toMatch(/Contact/);
    const noExpires = await run('Contact: mailto:security@shop.example\n');
    expect(noExpires.verdict).toBe('warn');
    expect(noExpires.message).toMatch(/Expires/);
    expect(noExpires.evidence).toMatchObject({ expires: null });
    const unparsable = await run('Contact: mailto:security@shop.example\nExpires: soon\n');
    expect(unparsable.verdict).toBe('warn');
    expect(unparsable.message).toMatch(/lacks a valid Expires/);
    const expired = await run(
      'Contact: mailto:security@shop.example\nExpires: 2020-01-01T00:00:00Z\n',
    );
    expect(expired.verdict).toBe('warn');
    expect(expired.message).toBe('security.txt has expired');
  });

  it('passes with a contact and a future Expires', async () => {
    const outcome = await run(`Contact: mailto:security@shop.example\nExpires: ${future}\n`);
    expect(outcome.verdict).toBe('pass');
    expect(outcome.evidence).toMatchObject({
      contacts: ['mailto:security@shop.example'],
      expires: future,
    });
  });
});
