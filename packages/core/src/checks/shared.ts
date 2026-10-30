import type { Fetcher } from '../http/types.js';
import { HtmlDocument } from '../parsers/html.js';
import type { Target } from '../target/types.js';

export interface ProductPage {
  url: string;
  status: number;
  doc: HtmlDocument;
}

/** Fetches every sampled product page (cached by the fetcher across checks). */
export async function productPages(target: Target, fetcher: Fetcher): Promise<ProductPage[]> {
  const pages: ProductPage[] = [];
  for (const url of target.sampled.products) {
    const response = await fetcher.fetch(url);
    pages.push({ url, status: response.status, doc: new HtmlDocument(response.body) });
  }
  return pages;
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
}

export function storeApiUrl(target: Target, path: string): string {
  return `${target.origin}/wp-json/wc/store/v1${path}`;
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
    return Array.isArray(parsed) ? (parsed as StoreApiProduct[]) : null;
  } catch {
    return null;
  }
}

export function pathOf(url: string): string {
  const parsed = new URL(url);
  return parsed.pathname + parsed.search;
}
