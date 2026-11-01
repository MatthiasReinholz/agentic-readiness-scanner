import type { FetchedResponse, Fetcher } from '../http/types.js';
import { HtmlDocument } from '../parsers/html.js';
import type { Target } from '../target/types.js';
import { skip, type CheckOutcome } from './types.js';

export { ADD_TO_CART, looksLikeProductPage } from '../parsers/product-page.js';

export interface ProductPage {
  url: string;
  status: number;
  doc: HtmlDocument;
  /** True when the page answered 2xx: its content can be judged. */
  readable: boolean;
  /** Why the page could not be read, when it could not (status 0, 4xx, 5xx). */
  failure?: string;
  /**
   * When the page was served, in epoch milliseconds: the server's Date header, else the
   * scanner's clock. Dated claims in the markup (priceValidUntil) are judged against it,
   * so a recorded response is judged the same way every time it is replayed.
   */
  fetchedAt: number;
}

/**
 * One line that says why a response is not usable: the transport or policy error the
 * fetcher recorded (a dropped connection, a timeout, a URL robots.txt disallows for the
 * scanner), or the HTTP status. Checks quote it instead of judging a page they never read.
 */
export function describeFailure(response: Pick<FetchedResponse, 'status' | 'error'>): string {
  if (response.status === 0) return response.error ?? 'no response';
  return `HTTP ${response.status}`;
}

/**
 * True when the scanner itself declined the request because the store's robots.txt
 * disallows the path for its product token. Such a response says nothing about the
 * resource; checks report it as not verified, never as absent or broken.
 */
export function blockedByRobots(response: Pick<FetchedResponse, 'status' | 'error'>): boolean {
  return response.status === 0 && /robots\.txt/i.test(response.error ?? '');
}

/** Fetches every sampled product page (cached by the fetcher across checks). */
export async function productPages(target: Target, fetcher: Fetcher): Promise<ProductPage[]> {
  const pages: ProductPage[] = [];
  for (const url of target.sampled.products) {
    const response = await fetcher.fetch(url);
    const readable = response.status >= 200 && response.status < 300;
    const served = Date.parse(response.headers.date ?? '');
    pages.push({
      url,
      status: response.status,
      doc: new HtmlDocument(response.body),
      readable,
      ...(readable ? {} : { failure: describeFailure(response) }),
      fetchedAt: Number.isFinite(served) ? served : Date.now(),
    });
  }
  return pages;
}

/** The sampled product URLs that answered with no readable page (status 0, 4xx or 5xx). */
export function unfetched(target: Target, pages: ProductPage[]): string[] {
  const read = new Set(pages.map((page) => page.url));
  return target.sampled.products.filter((url) => !read.has(url));
}

/** "; 1 of 2 sampled page(s) could not be fetched" when some sampled pages failed, else empty. */
export function fetchNote(target: Target, pages: ProductPage[]): string {
  const failed = unfetched(target, pages).length;
  if (failed === 0) return '';
  return `; ${failed} of ${target.sampled.products.length} sampled page(s) could not be fetched`;
}

/**
 * The sampled product pages a content check may judge, and the outcome to return when
 * none can be: `skip` with reason `not_applicable` when nothing was sampled, `skip` with
 * reason `error` when pages were sampled but none answered. A page that was never read
 * is never scored as empty, blocked or malformed.
 */
export async function readableProductPages(
  target: Target,
  fetcher: Fetcher,
): Promise<{ pages: ProductPage[]; unavailable: CheckOutcome | null }> {
  const all = await productPages(target, fetcher);
  const pages = all.filter((page) => page.readable);
  if (all.length === 0)
    return { pages, unavailable: skip('not_applicable', 'no product pages sampled') };
  if (pages.length === 0) {
    const reasons = all.map((page) => `${page.url} (${page.failure ?? 'unknown'})`).join('; ');
    return {
      pages,
      unavailable: skip('error', `no sampled product page could be fetched: ${reasons}`, {
        pages: Object.fromEntries(all.map((page) => [page.url, page.failure ?? null])),
      }),
    };
  }
  return { pages, unavailable: null };
}

export interface StoreApiProduct {
  id: number;
  name: string;
  permalink: string;
  sku: string;
  global_unique_id?: string;
  type?: string;
  prices?: { price?: string; currency_code?: string };
  is_in_stock?: boolean;
  images?: unknown[];
  categories?: unknown[];
  /** Variation summaries of a variable product; empty for a simple one. */
  variations?: unknown[];
}

export function storeApiUrl(target: Target, path: string): string {
  return `${target.origin}/wp-json/wc/store/v1${path}`;
}

/** A product URL as a lookup key: without the trailing slash, so permalinks and sampled URLs meet. */
export function permalinkKey(url: string): string {
  return url.replace(/\/$/, '');
}

/** Store API products keyed by permalink, empty when the Store API is unavailable. */
export async function storeApiProductsByPermalink(
  target: Target,
  fetcher: Fetcher,
): Promise<Map<string, StoreApiProduct>> {
  const byPermalink = new Map<string, StoreApiProduct>();
  for (const product of (await storeApiProducts(target, fetcher)) ?? []) {
    byPermalink.set(permalinkKey(product.permalink), product);
  }
  return byPermalink;
}

/** Store API product list (first page), or null when unavailable. Cached by the fetcher. */
export async function storeApiProducts(
  target: Target,
  fetcher: Fetcher,
  perPage = 20,
): Promise<StoreApiProduct[] | null> {
  if (target.platform !== 'woocommerce') return null;
  const response = await fetcher.fetch(storeApiUrl(target, `/products?per_page=${perPage}`));
  if (response.status !== 200) return null;
  try {
    const parsed: unknown = JSON.parse(response.body);
    if (!Array.isArray(parsed)) return null;
    // Keep only entries with the fields the checks dereference; a plugin-mangled payload
    // must degrade to "fewer products", never to a thrown TypeError inside a check.
    return parsed.filter(isStoreApiProduct);
  } catch {
    return null;
  }
}

function isStoreApiProduct(value: unknown): value is StoreApiProduct {
  if (!value || typeof value !== 'object') return false;
  const record = value as Record<string, unknown>;
  return typeof record.permalink === 'string' && typeof record.name === 'string';
}

export function pathOf(url: string): string {
  const parsed = new URL(url);
  return parsed.pathname + parsed.search;
}
