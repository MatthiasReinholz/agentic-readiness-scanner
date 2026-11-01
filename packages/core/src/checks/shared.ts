import type { FetchedResponse, Fetcher } from '../http/types.js';
import { HtmlDocument } from '../parsers/html.js';
import { extractJsonLd, productNodes } from '../parsers/jsonld.js';
import type { Target } from '../target/types.js';
import { skip, type CheckOutcome } from './types.js';

/** Controls whose name, class, id, value or text say they add the item to the cart. */
export const ADD_TO_CART = /add[-_ ]?to[-_ ]?cart|single_add_to_cart_button|buy now/i;

/**
 * True when a document is a product page: it carries Product JSON-LD or an add-to-cart
 * control. Used to reject a product that was linked with a policy word in its name
 * ("WooCommerce Shipping") when the scan looked for a policy page.
 */
export function looksLikeProductPage(doc: HtmlDocument): boolean {
  if (productNodes(extractJsonLd(doc).nodes).length > 0) return true;
  if (
    doc
      .controls()
      .some((control) =>
        ADD_TO_CART.test(
          `${control.name ?? ''} ${control.className ?? ''} ${control.id ?? ''} ${control.value ?? ''} ${control.text}`,
        ),
      )
  )
    return true;
  // A "Buy now" or "Add to cart" link does the same job as a button on marketing pages.
  return doc.anchors().some((anchor) => ADD_TO_CART.test(anchor.text));
}

export interface ProductPage {
  url: string;
  status: number;
  doc: HtmlDocument;
  /** True when the page answered 2xx: its content can be judged. */
  readable: boolean;
  /** Why the page could not be read, when it could not (status 0, 4xx, 5xx). */
  failure?: string;
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

/** Fetches every sampled product page (cached by the fetcher across checks). */
export async function productPages(target: Target, fetcher: Fetcher): Promise<ProductPage[]> {
  const pages: ProductPage[] = [];
  for (const url of target.sampled.products) {
    const response = await fetcher.fetch(url);
    const readable = response.status >= 200 && response.status < 300;
    pages.push({
      url,
      status: response.status,
      doc: new HtmlDocument(response.body),
      readable,
      ...(readable ? {} : { failure: describeFailure(response) }),
    });
  }
  return pages;
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
