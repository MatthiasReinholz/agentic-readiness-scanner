import type { Element } from 'domhandler';

import { contentType, type FetchedResponse, type FetchOptions } from '../../http/types.js';
import { attribute, HtmlDocument } from '../../parsers/html.js';
import { extractJsonLd, offersOf, productNodes, asString } from '../../parsers/jsonld.js';
import { mediaTypeOf } from '../../parsers/link-header.js';
import { fnv1a32 } from '../../target/sampling.js';
import { productPages } from '../shared.js';
import {
  defineCheck,
  fail,
  outcomeForRatio,
  pass,
  skip,
  warn,
  type CheckOutcome,
} from '../types.js';

/**
 * A price in page text: a currency sign or code next to an amount. The amount pattern
 * has bounded repetitions (groups of three digits, at most two decimals) so matching
 * stays linear on pages full of numbers; the text is capped as well.
 */
const CURRENCY = '(?:[$€£¥]|USD|EUR|GBP|CHF|JPY|AUD|CAD|SEK|NOK|DKK|PLN|CZK)';
const AMOUNT = '(?:\\d{1,3}(?:[.,]\\d{3}){1,4}|\\d{1,7})(?:[.,]\\d{1,2})?';
const PRICE_TEXT = new RegExp(`${CURRENCY}\\s?${AMOUNT}|\\b${AMOUNT}\\s?${CURRENCY}`);
/** Characters of page text examined for a price; prices appear early on a product page. */
const PRICE_TEXT_LIMIT = 50_000;

export function hasPriceText(text: string): boolean {
  return PRICE_TEXT.test(text.slice(0, PRICE_TEXT_LIMIT));
}

export const serverRenderedProductContent = defineCheck('A3.2', async ({ target, fetcher }) => {
  const pages = await productPages(target, fetcher);
  if (pages.length === 0) {
    return skip('not_applicable', 'no product pages sampled');
  }
  const perPage: Record<
    string,
    { title: boolean; price: boolean; description: boolean; words: number }
  > = {};
  let complete = 0;
  for (const page of pages) {
    const { nodes } = extractJsonLd(page.doc);
    const products = productNodes(nodes);
    const text = page.doc.text();
    const title =
      Boolean(page.doc.title()) || products.some((product) => asString(product.name) !== null);
    const price =
      products.some((product) =>
        offersOf(product).some((offer) => asString(offer.price) !== null),
      ) ||
      hasPriceText(text) ||
      page.doc.find('*', 'class', /\bprice\b/).length > 0;
    const words = page.doc.wordCount();
    const description =
      Boolean(page.doc.meta('description')) ||
      products.some((product) => asString(product.description) !== null) ||
      words > 80;
    perPage[page.url] = { title, price, description, words };
    if (title && price && description) complete += 1;
  }
  return outcomeForRatio(
    complete,
    pages.length,
    `${complete} of ${pages.length} sampled product page(s) carry title, price and description in raw HTML`,
    { pages: perPage, complete, total: pages.length },
    0,
  );
});

/**
 * Byte and time limits for one product page. Sizes are HTML bytes as transferred, in
 * decimal kilobytes; times cover the whole response as the fetcher measured it, so they
 * are an upper bound on time to first byte.
 */
const PAGE_WEIGHT_PASS = { bytes: 1_000_000, ms: 3_000 };
const PAGE_WEIGHT_WARN = { bytes: 2_000_000, ms: 8_000 };

function kilobytes(bytes: number): string {
  return `${Math.round(bytes / 1000)} KB`;
}

export const pageWeightAndResponseTime = defineCheck('A3.3', async ({ target, fetcher }) => {
  // No sampled product pages: measure the home page instead and say so, rather than
  // skipping a check every store can answer.
  const sampled = target.sampled.products.length > 0 ? 'products' : 'home';
  const responses: FetchedResponse[] = [];
  if (sampled === 'products') {
    for (const url of target.sampled.products) responses.push(await fetcher.fetch(url));
  } else {
    responses.push(target.home);
  }
  const perPage: Record<
    string,
    { status: number; bytes: number; response_ms: number; truncated: boolean }
  > = {};
  let largest = 0;
  let slowest = 0;
  let truncated = false;
  for (const response of responses) {
    perPage[response.url] = {
      status: response.status,
      bytes: response.bytes,
      response_ms: response.durationMs,
      truncated: response.truncated,
    };
    largest = Math.max(largest, response.bytes);
    slowest = Math.max(slowest, response.durationMs);
    truncated ||= response.truncated;
  }
  const evidence = {
    sampled,
    pages: perPage,
    largest_bytes: largest,
    slowest_response_ms: slowest,
    // A truncated body means the fetcher stopped reading; its size is a lower bound.
    truncated,
    thresholds: { pass: PAGE_WEIGHT_PASS, warn: PAGE_WEIGHT_WARN },
  };
  const subject =
    sampled === 'home' ? 'the home page (no product pages sampled)' : 'a sampled product page';
  const measured = `largest ${kilobytes(largest)}, slowest response time ${slowest} ms`;
  if (largest >= PAGE_WEIGHT_WARN.bytes || slowest >= PAGE_WEIGHT_WARN.ms) {
    return fail(`${subject} exceeds 2 MB or 8 s response time (${measured})`, evidence);
  }
  if (largest >= PAGE_WEIGHT_PASS.bytes || slowest >= PAGE_WEIGHT_PASS.ms) {
    return warn(`${subject} exceeds 1 MB or 3 s response time (${measured})`, evidence);
  }
  return pass(
    `${sampled === 'home' ? subject : 'every sampled product page'} is under 1 MB and 3 s response time (${measured})`,
    evidence,
  );
});

function resolveUrl(href: string, base: string): string | null {
  try {
    return new URL(href, base).href;
  } catch {
    return null;
  }
}

function hasRel(rel: string, token: string): boolean {
  return rel.split(/\s+/).includes(token);
}

export const canonicalAndHreflang = defineCheck('A3.4', async ({ target, fetcher }) => {
  const pages = await productPages(target, fetcher);
  if (pages.length === 0) {
    return skip('not_applicable', 'no product pages sampled');
  }
  const perPage: Record<
    string,
    {
      canonical: string | null;
      canonical_count: number;
      same_origin: boolean;
      hreflang: string[];
      x_default: boolean;
    }
  > = {};
  let missing = 0;
  let several = 0;
  let elsewhere = 0;
  let withHreflang = 0;
  let thinHreflang = 0;
  const languages = new Set<string>();
  for (const page of pages) {
    const links = page.doc.links();
    const canonicals = links
      .filter((link) => hasRel(link.rel, 'canonical'))
      .map((link) => resolveUrl(link.href, page.url));
    const sameOrigin =
      canonicals.length > 0 &&
      canonicals.every((url) => url !== null && new URL(url).origin === target.origin);
    const alternates = links
      .filter((link) => hasRel(link.rel, 'alternate') && link.hreflang)
      .map((link) => (link.hreflang ?? '').toLowerCase());
    const xDefault = alternates.includes('x-default');
    const pageLanguages = [...new Set(alternates.filter((code) => code !== 'x-default'))].sort();
    for (const code of pageLanguages) languages.add(code);
    perPage[page.url] = {
      canonical: canonicals[0] ?? null,
      canonical_count: canonicals.length,
      same_origin: sameOrigin,
      hreflang: pageLanguages,
      x_default: xDefault,
    };
    if (canonicals.length === 0) missing += 1;
    else if (canonicals.length > 1) several += 1;
    else if (!sameOrigin) elsewhere += 1;
    if (alternates.length > 0) {
      withHreflang += 1;
      if (!xDefault && pageLanguages.length < 2) thinHreflang += 1;
    }
  }
  const total = pages.length;
  const evidence = {
    pages: perPage,
    total,
    missing,
    hreflang_pages: withHreflang,
    languages: [...languages].sort(),
  };
  if (missing > 0) {
    return fail(`${missing} of ${total} sampled product page(s) carry no rel=canonical`, evidence);
  }
  if (several > 0) {
    return warn(
      `${several} of ${total} sampled product page(s) carry more than one rel=canonical`,
      evidence,
    );
  }
  if (elsewhere > 0) {
    return warn(
      `rel=canonical on ${elsewhere} of ${total} sampled product page(s) points to another origin`,
      evidence,
    );
  }
  if (withHreflang > 0 && withHreflang < total) {
    return warn(
      `hreflang alternates on ${withHreflang} of ${total} sampled product page(s) only`,
      evidence,
    );
  }
  if (thinHreflang > 0) {
    return warn(
      `hreflang alternates on ${thinHreflang} page(s) name fewer than two languages and no x-default`,
      evidence,
    );
  }
  const hreflangNote =
    withHreflang > 0 ? ` with hreflang alternates for ${[...languages].sort().join(', ')}` : '';
  return pass(
    `rel=canonical on every sampled product page resolves to ${target.hostname}${hreflangNote}`,
    evidence,
  );
});

/**
 * Consent banners, modals and overlays as themes name them. Class and id values are
 * matched against literal alternatives only, so the test stays linear.
 */
const OVERLAY_NAME = /cookie|consent|gdpr|modal|overlay|popup/i;
/** Tags that render nothing: a `<script id="cookie-consent">` is not an overlay. */
const NON_OVERLAY_TAGS = new Set([
  'script',
  'style',
  'template',
  'noscript',
  'link',
  'meta',
  'svg',
]);

export function looksLikeOverlay(element: Element): boolean {
  if (NON_OVERLAY_TAGS.has(element.name)) return false;
  if (attribute(element, 'role')?.toLowerCase() === 'dialog') return true;
  if (attribute(element, 'aria-modal')?.toLowerCase() === 'true') return true;
  return OVERLAY_NAME.test(
    `${attribute(element, 'class') ?? ''} ${attribute(element, 'id') ?? ''}`,
  );
}

/** A short CSS-like description of an element for evidence, e.g. div#cookie-banner.modal. */
function describe(element: Element): string {
  const id = attribute(element, 'id');
  const classes = (attribute(element, 'class') ?? '').split(/\s+/).filter(Boolean).slice(0, 3);
  return `${element.name}${id ? `#${id}` : ''}${classes.map((name) => `.${name}`).join('')}`.slice(
    0,
    120,
  );
}

export const accessibleMainContent = defineCheck('A3.5', async ({ target, fetcher }) => {
  const sampled = target.sampled.products.length > 0 ? 'products' : 'home';
  const docs: { url: string; doc: HtmlDocument }[] =
    sampled === 'products'
      ? await productPages(target, fetcher)
      : [{ url: target.home.finalUrl, doc: target.homeDoc }];
  const perPage: Record<string, { main_landmark: boolean; overlay_before_main: string | null }> =
    {};
  let missing = 0;
  let overlaid = 0;
  for (const { url, doc } of docs) {
    const main = doc.mainLandmark();
    const overlay = doc.firstElement(looksLikeOverlay);
    const overlayBefore = main !== null && overlay !== null && doc.precedes(overlay, main);
    perPage[url] = {
      main_landmark: main !== null,
      overlay_before_main: overlayBefore && overlay ? describe(overlay) : null,
    };
    if (main === null) missing += 1;
    if (overlayBefore) overlaid += 1;
  }
  const total = docs.length;
  const evidence = { sampled, pages: perPage, total, missing_main: missing, overlaid };
  const pageWord =
    sampled === 'home' ? 'home page (no product pages sampled)' : 'sampled product page(s)';
  // Weight 1 and a heuristic: a missing or overlaid landmark warns, never fails.
  if (missing > 0) {
    return warn(`${missing} of ${total} ${pageWord} have no main landmark`, evidence);
  }
  if (overlaid > 0) {
    return warn(
      `an overlay-like element precedes the main landmark on ${overlaid} of ${total} ${pageWord}`,
      evidence,
    );
  }
  return pass(
    `main landmark present on ${sampled === 'home' ? 'the home page (no product pages sampled)' : 'every sampled product page'} with no overlay markup before it`,
    evidence,
  );
});

/** What a coding agent sends when it wants Markdown. */
export const MARKDOWN_ACCEPT = 'text/markdown, text/html;q=0.9';
/** Requests this check sends at most: the negotiated page, a Markdown alternate, the .md neighbour. */
const MARKDOWN_REQUEST_LIMIT = 3;
/** Characters of a Markdown body searched for the product name; the heading is at the top. */
const MARKDOWN_SEARCH_LIMIT = 200_000;

/**
 * Names a Markdown copy must carry to count as the same page: the Product name from
 * JSON-LD, the <title>, and the title before its site-name separator ("Mug – Shop").
 */
export function pageNames(doc: HtmlDocument): string[] {
  const names = new Set<string>();
  for (const product of productNodes(extractJsonLd(doc).nodes)) {
    const name = asString(product.name)?.trim();
    if (name) names.add(name);
  }
  const title = doc.title();
  if (title) {
    names.add(title);
    const head = title.split(/\s+[|–—-]\s+/, 1)[0]?.trim();
    if (head) names.add(head);
  }
  return [...names];
}

function namesPage(body: string, names: string[]): boolean {
  const haystack = body.slice(0, MARKDOWN_SEARCH_LIMIT).replace(/\s+/g, ' ').toLowerCase();
  return names.some((name) => haystack.includes(name.replace(/\s+/g, ' ').toLowerCase()));
}

function variesOnAccept(response: FetchedResponse): boolean {
  return (response.headers.vary ?? '')
    .split(',')
    .map((value) => value.trim().toLowerCase())
    .some((value) => value === 'accept' || value === '*');
}

/** /product/mug/ becomes /product/mug.md; query and fragment are dropped. */
export function markdownNeighbour(pageUrl: string): string {
  const url = new URL(pageUrl);
  url.search = '';
  url.hash = '';
  url.pathname = `${url.pathname.replace(/\/$/, '')}.md`;
  return url.href;
}

function isMarkdown(response: FetchedResponse): boolean {
  return response.status === 200 && contentType(response) === 'text/markdown';
}

export const markdownCopyOfProductPages = defineCheck('A3.1', async ({ target, fetcher }) => {
  const url = target.sampled.products[0];
  if (url === undefined) {
    return skip('not_applicable', 'no product pages sampled');
  }
  let sent = 0;
  const get = async (requestUrl: string, options?: FetchOptions): Promise<FetchedResponse> => {
    const response = await fetcher.fetch(requestUrl, options);
    if (!response.fromCache) sent += 1;
    return response;
  };
  const negotiated = await get(url, { headers: { Accept: MARKDOWN_ACCEPT } });
  // The HTML copy: the negotiated answer when the server ignored Accept, else the plain
  // page, which earlier checks fetched and the fetcher cached.
  const html = contentType(negotiated) === 'text/html' ? negotiated : await get(url);
  const doc = new HtmlDocument(html.body);
  const names = pageNames(doc);
  const evidence: Record<string, unknown> = {
    url,
    names,
    negotiated: {
      status: negotiated.status,
      content_type: contentType(negotiated),
      vary: negotiated.headers.vary ?? null,
      names_product: isMarkdown(negotiated) ? namesPage(negotiated.body, names) : null,
    },
    alternate: null,
    md: null,
    outcome: 'none',
  };
  if (isMarkdown(negotiated) && namesPage(negotiated.body, names)) {
    evidence.outcome = 'negotiated';
    if (!variesOnAccept(negotiated)) {
      return warn(
        'the product page answers Accept: text/markdown with Markdown but sends no Vary: Accept, so a shared cache may serve Markdown to browsers',
        evidence,
      );
    }
    return pass(
      'the product page answers Accept: text/markdown with Markdown that names the product',
      evidence,
    );
  }
  const probe = async (
    label: 'alternate' | 'md',
    probeUrl: string,
  ): Promise<CheckOutcome | null> => {
    if (sent >= MARKDOWN_REQUEST_LIMIT) {
      evidence[label] = { url: probeUrl, skipped: 'request limit reached' };
      return null;
    }
    const response = await get(probeUrl);
    const markdown = isMarkdown(response);
    const named = markdown && namesPage(response.body, names);
    evidence[label] = {
      url: probeUrl,
      status: response.status,
      content_type: contentType(response),
      names_product: markdown ? named : null,
    };
    if (!named) return null;
    evidence.outcome = label;
    return pass(
      label === 'alternate'
        ? `the Markdown alternate ${probeUrl} names the product`
        : `${probeUrl} answers Markdown that names the product`,
      evidence,
    );
  };
  const alternate = doc
    .links()
    .find((link) => hasRel(link.rel, 'alternate') && mediaTypeOf(link.type) === 'text/markdown');
  const alternateUrl = alternate ? resolveUrl(alternate.href, url) : null;
  if (alternateUrl !== null) {
    const outcome = await probe('alternate', alternateUrl);
    if (outcome) return outcome;
  }
  const outcome = await probe('md', markdownNeighbour(url));
  if (outcome) return outcome;
  return fail(
    'no Markdown copy of the product page: content negotiation, a rel=alternate link and the .md neighbour all failed',
    evidence,
  );
});

/** A path under the origin that cannot exist, fixed per hostname so a scan stays deterministic. */
export function probeUrlFor(origin: string, hostname: string): string {
  return `${origin}/agentic-readiness-probe-${fnv1a32(hostname).toString(16).padStart(8, '0')}`;
}

function isOriginRoot(url: string, origin: string): boolean {
  try {
    const parsed = new URL(url);
    return parsed.origin === origin && parsed.pathname === '/' && parsed.search === '';
  } catch {
    return false;
  }
}

export const unknownUrlsAnswer404 = defineCheck('A3.6', async ({ target, fetcher }) => {
  const url = probeUrlFor(target.origin, target.hostname);
  const response = await fetcher.fetch(url);
  const type = contentType(response);
  const evidence = {
    url,
    status: response.status,
    final_url: response.finalUrl,
    content_type: type,
  };
  if (response.status === 0) {
    return skip(
      'error',
      `the probe URL could not be fetched: ${response.error ?? 'no response'}`,
      evidence,
    );
  }
  if (response.status === 404 || response.status === 410) {
    return pass(`an unknown URL answers HTTP ${response.status}`, evidence);
  }
  if (isOriginRoot(response.finalUrl, target.origin)) {
    return warn('an unknown URL redirects to the home page instead of answering 404', evidence);
  }
  if (response.status >= 300 && response.status < 400) {
    return warn(
      `an unknown URL answers HTTP ${response.status} (a redirect) instead of 404`,
      evidence,
    );
  }
  const html =
    type === 'text/html' ||
    type === 'application/xhtml+xml' ||
    /<html|<!doctype/i.test(response.body.slice(0, 500));
  if (response.status === 200 && html) {
    return fail('an unknown URL answers HTTP 200 with an HTML page (soft 404)', evidence);
  }
  return warn(
    `an unknown URL answers HTTP ${response.status}${type ? ` (${type})` : ''} instead of 404`,
    evidence,
  );
});
