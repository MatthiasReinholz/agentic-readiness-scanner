import { contentType, type FetchedResponse } from '../../http/types.js';
import { looksLikeProductSitemap } from '../../parsers/sitemap.js';
import { storeApiProducts, storeApiUrl, type StoreApiProduct } from '../shared.js';
import { defineCheck, fail, pass, skip, warn } from '../types.js';

export const woocommerceDetected = defineCheck('B1.1', ({ target }) => {
  const evidence = {
    platform: target.platform,
    generator: target.homeDoc.meta('generator'),
    body_classes: target.homeDoc.bodyClasses().filter((c) => /woocommerce|shopify/i.test(c)),
  };
  if (target.platform === 'woocommerce') {
    return pass('WooCommerce detected', evidence);
  }
  return pass(`WooCommerce not detected (platform: ${target.platform})`, evidence);
});

export const storeApiReachable = defineCheck('B1.2', async ({ target, fetcher }) => {
  const url = storeApiUrl(target, '/products?per_page=1');
  const response = await fetcher.fetch(url);
  const total = response.headers['x-wp-total'] ?? null;
  const evidence: Record<string, unknown> = {
    url,
    status: response.status,
    content_type: contentType(response),
    total,
  };
  if (response.status === 401 || response.status === 403) {
    return fail(`Store API requires authentication (HTTP ${response.status})`, evidence);
  }
  if (response.status !== 200) {
    return fail(`Store API returned HTTP ${response.status}`, evidence);
  }
  try {
    const parsed: unknown = JSON.parse(response.body);
    if (!Array.isArray(parsed)) {
      return fail('Store API returned JSON that is not a product array', evidence);
    }
    evidence.products_in_first_page = parsed.length;
    return pass(
      `Store API answers with ${parsed.length} product(s) per page, ${total ?? '?'} total`,
      evidence,
    );
  } catch {
    return fail('Store API returned a non-JSON body', evidence);
  }
});

/**
 * Rate-limit headers worth recording: the IETF draft names WooCommerce emits (RateLimit-*
 * plus its own RateLimit-Retry-After), the HTTP Retry-After, and the X-RateLimit-* family
 * that proxies and WAFs add.
 */
const RATE_LIMIT_HEADERS = [
  'retry-after',
  'ratelimit-limit',
  'ratelimit-remaining',
  'ratelimit-reset',
  'ratelimit-retry-after',
  'x-ratelimit-limit',
  'x-ratelimit-remaining',
  'x-ratelimit-reset',
] as const;

function rateLimitHeaders(response: FetchedResponse): Record<string, string> {
  const found: Record<string, string> = {};
  for (const name of RATE_LIMIT_HEADERS) {
    const value = response.headers[name];
    if (value !== undefined) found[name] = value;
  }
  return found;
}

/**
 * The fetcher caches by URL, so three reads of one URL would be one request. Distinct page
 * sizes are always valid (unlike page numbers past the last page, which WordPress answers
 * with HTTP 400) and none of them collides with the URLs B1.2 and B1.4 read.
 */
const SEQUENTIAL_READ_PAGE_SIZES = [2, 3, 4] as const;

interface SequentialRead {
  url: string;
  status: number;
  headers: Record<string, string>;
}

function signalsRateLimit(read: SequentialRead): boolean {
  return (
    'retry-after' in read.headers ||
    'ratelimit-retry-after' in read.headers ||
    read.headers['ratelimit-remaining'] === '0' ||
    read.headers['x-ratelimit-remaining'] === '0'
  );
}

export const storeApiNotRateLimited = defineCheck('B1.3', async ({ target, fetcher }) => {
  const requests: SequentialRead[] = [];
  for (const perPage of SEQUENTIAL_READ_PAGE_SIZES) {
    const url = storeApiUrl(target, `/products?per_page=${perPage}`);
    const response = await fetcher.fetch(url);
    requests.push({ url, status: response.status, headers: rateLimitHeaders(response) });
  }
  const evidence = { requests };
  const limited = requests.find((read) => read.status === 429);
  if (limited) {
    return fail(`Store API rate-limited a sequential read (HTTP 429 on ${limited.url})`, evidence);
  }
  const failed = requests.find((read) => read.status >= 500 || read.status === 0);
  if (failed) {
    return fail(
      failed.status === 0
        ? `Store API read got no response (${failed.url})`
        : `Store API read returned HTTP ${failed.status} (${failed.url})`,
      evidence,
    );
  }
  const throttled = requests.find(signalsRateLimit);
  if (throttled) {
    return warn(
      `Store API reads succeed but signal a rate limit (${Object.keys(throttled.headers).join(', ')})`,
      evidence,
    );
  }
  return pass(
    `${requests.length} sequential Store API reads succeeded without throttling`,
    evidence,
  );
});

/** Fields whose absence fails B1.4: an agent cannot quote or reserve without them. */
const BLOCKING_PRODUCT_FIELDS = new Set([
  'name',
  'permalink',
  'prices.price',
  'prices.currency_code',
  'is_in_stock',
]);

function missingProductFields(product: StoreApiProduct): string[] {
  const missing: string[] = [];
  if (!product.name) missing.push('name');
  if (!product.permalink) missing.push('permalink');
  if (typeof product.prices?.price !== 'string' || product.prices.price === '') {
    missing.push('prices.price');
  }
  if (typeof product.prices?.currency_code !== 'string' || product.prices.currency_code === '') {
    missing.push('prices.currency_code');
  }
  if (typeof product.is_in_stock !== 'boolean') missing.push('is_in_stock');
  if (!Array.isArray(product.images) || product.images.length === 0) missing.push('images');
  if (!Array.isArray(product.categories) || product.categories.length === 0) {
    missing.push('categories');
  }
  return missing;
}

export const storeApiProductComplete = defineCheck('B1.4', async ({ target, fetcher }) => {
  const url = storeApiUrl(target, '/products?per_page=20');
  const response = await fetcher.fetch(url);
  const products = await storeApiProducts(target, fetcher, 20);
  if (!products) {
    return fail(
      response.status === 200
        ? 'Store API product list is not a JSON product array'
        : `Store API product list returned HTTP ${response.status}`,
      { url, status: response.status },
    );
  }
  if (products.length === 0) {
    return fail('Store API product list is empty, nothing to check', {
      url,
      status: response.status,
      products_checked: 0,
    });
  }
  const incomplete = products
    .map((product) => ({
      id: product.id,
      name: product.name,
      missing: missingProductFields(product),
    }))
    .filter((entry) => entry.missing.length > 0);
  const evidence = {
    url,
    products_checked: products.length,
    incomplete: incomplete.length,
    products: incomplete,
  };
  const blocking = incomplete.filter((entry) =>
    entry.missing.some((field) => BLOCKING_PRODUCT_FIELDS.has(field)),
  );
  if (blocking.length > 0) {
    return fail(
      `${blocking.length} of ${products.length} Store API product(s) lack a price, currency or stock status`,
      evidence,
    );
  }
  if (incomplete.length > 0) {
    return warn(
      `${incomplete.length} of ${products.length} Store API product(s) lack images or categories`,
      evidence,
    );
  }
  return pass(
    `all ${products.length} Store API product(s) carry the fields an agent needs`,
    evidence,
  );
});

function sameUrl(a: string, b: string, origin: string): boolean {
  try {
    return new URL(a, origin).href === new URL(b, origin).href;
  } catch {
    return a === b;
  }
}

/**
 * Whether the resolver read every sitemap the product count depends on. A urlset is
 * complete by definition; an index is complete when every product-named child was fetched,
 * or, when no child is product-named, when every child was fetched.
 */
export function sitemapProductCountComplete(
  sitemap: { kind: 'index' | 'urlset'; childSitemaps: string[]; fetchedSitemaps: string[] },
  origin: string,
): boolean {
  if (sitemap.kind === 'urlset') return true;
  const productChildren = sitemap.childSitemaps.filter(looksLikeProductSitemap);
  const relevant = productChildren.length > 0 ? productChildren : sitemap.childSitemaps;
  return relevant.every((child) =>
    sitemap.fetchedSitemaps.some((fetched) => sameUrl(child, fetched, origin)),
  );
}

export const sitemapMatchesStoreApi = defineCheck('B1.7', async ({ target, fetcher }) => {
  const sitemap = target.sitemap;
  if (!sitemap) {
    return skip('not_applicable', 'no sitemap to compare the Store API against', {});
  }
  const url = storeApiUrl(target, '/products?per_page=1');
  const response = await fetcher.fetch(url);
  const totalHeader = response.headers['x-wp-total'] ?? null;
  const storeApiTotal =
    totalHeader !== null && /^\d{1,12}$/.test(totalHeader) ? Number(totalHeader) : null;
  const sitemapCount = sitemap.productUrls.length;
  const evidence: Record<string, unknown> = {
    sitemap_url: sitemap.url,
    sitemap_product_urls: sitemapCount,
    product_sitemaps: sitemap.childSitemaps.filter(looksLikeProductSitemap),
    fetched_sitemaps: sitemap.fetchedSitemaps,
    store_api_url: url,
    store_api_status: response.status,
    store_api_total: storeApiTotal,
  };
  if (!sitemapProductCountComplete(sitemap, target.origin)) {
    return skip(
      'budget_exhausted',
      'not every product sitemap was read within budget, so a count comparison would be unfair',
      evidence,
    );
  }
  if (storeApiTotal === null) {
    return fail(
      response.status === 200
        ? 'Store API product list carries no numeric X-WP-Total header'
        : `Store API product list returned HTTP ${response.status}`,
      evidence,
    );
  }
  if (sitemapCount === 0 || storeApiTotal === 0) {
    return fail(
      `sitemap lists ${sitemapCount} product URL(s) while the Store API reports ${storeApiTotal}`,
      evidence,
    );
  }
  const deviation = Math.abs(sitemapCount - storeApiTotal) / Math.max(sitemapCount, storeApiTotal);
  evidence.ratio = Number((sitemapCount / storeApiTotal).toFixed(3));
  evidence.deviation = Number(deviation.toFixed(3));
  const message = `sitemap lists ${sitemapCount} product URL(s), Store API reports ${storeApiTotal} (${Math.round(deviation * 100)} percent apart)`;
  if (deviation <= 0.1) return pass(message, evidence);
  if (deviation <= 0.25) return warn(message, evidence);
  return fail(message, evidence);
});
