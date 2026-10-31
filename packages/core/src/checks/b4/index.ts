import { contentType } from '../../http/types.js';
import { HtmlDocument } from '../../parsers/html.js';
import { parseSecurityTxt } from '../../parsers/security-txt.js';
import { defineCheck, fail, pass, warn } from '../types.js';

/**
 * Signs that a shipping page states concrete terms: an amount with a currency, a
 * delivery time in days, or a well-known keyword. Each alternative has bounded
 * repetitions so matching stays linear on long numeric pages; the text is capped too.
 */
const SHIPPING_AMOUNT =
  /(?:\d{1,3}(?:[.,]\d{3}){1,4}|\d{1,7})(?:[.,]\d{1,2})?\s?(?:[€$£]|(?:eur|usd|gbp|chf)\b)|[€$£]\s?\d/i;
const SHIPPING_DAYS =
  /\b\d{1,3}(?:\s?(?:-|–|to|bis)\s?\d{1,3})?\s?(?:business days|working days|days|tage|werktage|jours)\b/i;
const SHIPPING_KEYWORDS =
  /free shipping|kostenlos|versandkosten|versandkostenfrei|delivery time|lieferzeit|worldwide|europe|international/i;
const SHIPPING_TEXT_LIMIT = 50_000;

export function hasShippingDetails(text: string): boolean {
  const sample = text.slice(0, SHIPPING_TEXT_LIMIT);
  return (
    SHIPPING_KEYWORDS.test(sample) || SHIPPING_AMOUNT.test(sample) || SHIPPING_DAYS.test(sample)
  );
}

export const returnPolicyFound = defineCheck('B4.1', async ({ target, fetcher }) => {
  const url = target.sampled.policies.returns;
  if (!url)
    return fail('no return or refund policy link found on the homepage', {
      candidates: target.sampled.policies,
    });
  const response = await fetcher.fetch(url);
  const words = new HtmlDocument(response.body).wordCount();
  const evidence = { url, status: response.status, words };
  if (response.status !== 200)
    return fail(`return policy page returned HTTP ${response.status}`, evidence);
  if (words < 300) return warn(`return policy page is short (${words} words)`, evidence);
  return pass(`return policy at ${url} (${words} words)`, evidence);
});

export const shippingPolicyFound = defineCheck('B4.2', async ({ target, fetcher }) => {
  const url = target.sampled.policies.shipping;
  if (!url)
    return fail('no shipping or delivery policy link found on the homepage', {
      candidates: target.sampled.policies,
    });
  const response = await fetcher.fetch(url);
  const doc = new HtmlDocument(response.body);
  const text = doc.text();
  const mentionsDetails = hasShippingDetails(text);
  const evidence = {
    url,
    status: response.status,
    words: doc.wordCount(),
    mentions_costs_regions_or_times: mentionsDetails,
  };
  if (response.status !== 200)
    return fail(`shipping policy page returned HTTP ${response.status}`, evidence);
  if (!mentionsDetails)
    return warn('shipping page does not mention regions, costs or delivery times', evidence);
  return pass(`shipping policy at ${url}`, evidence);
});

export const privacyAndTermsFound = defineCheck('B4.3', async ({ target, fetcher }) => {
  const privacyUrl = target.sampled.policies.privacy;
  const termsUrl = target.sampled.policies.terms;
  const evidence: Record<string, unknown> = {
    privacy: privacyUrl ?? null,
    terms: termsUrl ?? null,
  };
  let found = 0;
  for (const [kind, url] of [
    ['privacy', privacyUrl],
    ['terms', termsUrl],
  ] as const) {
    if (!url) continue;
    const response = await fetcher.fetch(url);
    evidence[`${kind}_status`] = response.status;
    if (response.status === 200) found += 1;
  }
  if (found === 2) return pass('privacy policy and terms pages found', evidence);
  if (found === 1) return warn('only one of privacy policy and terms was found', evidence);
  return fail('neither privacy policy nor terms page found', evidence);
});

export const securityTxt = defineCheck('B4.7', async ({ target, fetcher }) => {
  const url = `${target.origin}/.well-known/security.txt`;
  const response = await fetcher.fetch(url);
  const evidence: Record<string, unknown> = {
    url,
    status: response.status,
    content_type: contentType(response),
  };
  if (response.status !== 200 || /<html|<!doctype/i.test(response.body.slice(0, 500))) {
    return fail('no security.txt', evidence);
  }
  const parsed = parseSecurityTxt(response.body);
  evidence.contacts = parsed.contacts;
  evidence.expires = parsed.expires?.toISOString() ?? null;
  if (parsed.contacts.length === 0) return warn('security.txt lacks a Contact field', evidence);
  if (!parsed.expires) return warn('security.txt lacks a valid Expires field', evidence);
  if (parsed.expires.getTime() < Date.now()) return warn('security.txt has expired', evidence);
  return pass(
    `security.txt with ${parsed.contacts.length} contact(s), expires ${parsed.expires.toISOString().slice(0, 10)}`,
    evidence,
  );
});
