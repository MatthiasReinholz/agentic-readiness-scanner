import { contentType } from '../../http/types.js';
import { HtmlDocument } from '../../parsers/html.js';
import { isRecord, looksLikeHtml, parseJson } from '../json.js';
import { blockedByRobots, describeFailure } from '../shared.js';
import { defineCheck, fail, pass, skip, warn } from '../types.js';

const HANDLE_SAMPLE = 5;
const TITLE_LIMIT = 80;

/** The message both Shopify-only checks give on a storefront Shopify does not serve itself. */
export const HEADLESS_SHOPIFY =
  'headless Shopify storefront: Shopify serves neither products.json nor the UCP endpoint on this domain';

/** What an HTML answer with this status most likely is; the status itself is always named. */
function htmlAnswerHint(status: number): string {
  if (status === 403) return 'the CDN or bot manager refused the request';
  if (status >= 500) return 'the storefront errored';
  if (status >= 200 && status < 300)
    return 'the request was redirected to a theme page or a bot challenge';
  return 'the endpoint is not serving JSON';
}

/** A Shopify storefront password page: a password form, or the "Opening Soon" title. */
function isPasswordPage(doc: HtmlDocument): boolean {
  return (
    doc.find('input', 'type', /^password$/i).length > 0 ||
    doc.find('form', 'action', /password/i).length > 0 ||
    /opening soon/i.test(doc.title() ?? '')
  );
}

export const shopifyProductsJsonReadable = defineCheck('B1.8', async ({ target, fetcher }) => {
  if (target.platform !== 'shopify') {
    return skip('not_applicable', 'requires Shopify, which was not detected', {
      platform: target.platform,
    });
  }
  if (target.shopifyHosted === false) {
    return skip('not_applicable', HEADLESS_SHOPIFY, {
      platform: target.platform,
      shopify_hosted: false,
    });
  }
  const url = `${target.origin}/products.json?limit=${HANDLE_SAMPLE}`;
  const response = await fetcher.fetch(url);
  const evidence: Record<string, unknown> = {
    url,
    status: response.status,
    content_type: contentType(response),
  };
  if (response.status === 0) {
    evidence.error = response.error ?? null;
    // The scanner itself did not read the endpoint: that is not evidence that it is off.
    if (blockedByRobots(response)) {
      return warn(
        `products.json was not requested because the store's robots.txt disallows it for the scanner (${describeFailure(response)}); whether it is readable could not be verified`,
        evidence,
      );
    }
    return fail(`products.json could not be fetched: ${describeFailure(response)}`, evidence);
  }
  // Shopify rate-limits this endpoint per IP after a few requests; the fetcher's one retry
  // after Retry-After did not recover here, so nothing can be said about readability.
  if (response.status === 429) {
    return skip(
      'error',
      'products.json answered HTTP 429 (Shopify rate-limits this endpoint per IP), so whether it is readable could not be judged',
      evidence,
    );
  }
  if (response.status === 401) {
    return fail(
      'products.json requires authentication (HTTP 401): the storefront is password-protected or the public JSON endpoints are disabled',
      evidence,
    );
  }
  if (response.status === 404) {
    return fail(
      'products.json is not available (HTTP 404): the public JSON endpoints are disabled or an app rewrites the route',
      evidence,
    );
  }
  if (looksLikeHtml(response.body)) {
    const doc = new HtmlDocument(response.body);
    evidence.title = doc.title();
    if (isPasswordPage(doc)) {
      evidence.password_page = true;
      return fail(
        'products.json answered the storefront password page: the store is not open to the public yet',
        evidence,
      );
    }
    const title = evidence.title;
    const titled =
      typeof title === 'string' && title !== '' ? ` titled "${title.slice(0, TITLE_LIMIT)}"` : '';
    return fail(
      `products.json answered ${describeFailure(response)} with an HTML page${titled} instead of JSON: ${htmlAnswerHint(response.status)}`,
      evidence,
    );
  }
  if (response.status !== 200) {
    return fail(`products.json returned ${describeFailure(response)}`, evidence);
  }
  const parsed = parseJson(response.body);
  if (parsed === undefined) {
    return fail(
      'products.json returned a non-JSON body: a bot challenge or an app is rewriting the endpoint',
      evidence,
    );
  }
  if (!isRecord(parsed) || !Array.isArray(parsed.products)) {
    return fail('products.json returned JSON without a products array', evidence);
  }
  const handles = parsed.products
    .filter(isRecord)
    .map((product) => product.handle)
    .filter((handle): handle is string => typeof handle === 'string')
    .slice(0, HANDLE_SAMPLE);
  evidence.count = parsed.products.length;
  evidence.handles = handles;
  return pass(
    `products.json lists ${parsed.products.length} product(s) without credentials`,
    evidence,
  );
});
