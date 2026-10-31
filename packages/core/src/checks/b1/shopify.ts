import { contentType } from '../../http/types.js';
import { HtmlDocument } from '../../parsers/html.js';
import { isRecord, looksLikeHtml, parseJson } from '../json.js';
import { defineCheck, fail, pass, skip } from '../types.js';

const HANDLE_SAMPLE = 5;

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
  const url = `${target.origin}/products.json?limit=${HANDLE_SAMPLE}`;
  const response = await fetcher.fetch(url);
  const evidence: Record<string, unknown> = {
    url,
    status: response.status,
    content_type: contentType(response),
  };
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
    return fail(
      `products.json answered an HTML page (HTTP ${response.status}) instead of JSON: the request was redirected to a theme page or a bot challenge`,
      evidence,
    );
  }
  if (response.status !== 200) {
    return fail(`products.json returned HTTP ${response.status}`, evidence);
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
