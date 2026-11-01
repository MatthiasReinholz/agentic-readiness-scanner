import type { Element } from 'domhandler';

import { contentType, isOk, type FetchedResponse, type FetchOptions } from '../../http/types.js';
import { attribute, HtmlDocument } from '../../parsers/html.js';
import { extractJsonLd, offersOf, productNodes, asString } from '../../parsers/jsonld.js';
import { hasPriceText } from '../../parsers/price.js';
import { hasLinkRelation, mediaTypeOf, parseLinkHeader } from '../../parsers/link-header.js';
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

/** The price-text pattern lives in parsers/price.ts; re-exported for the pattern tests. */
export { hasPriceText };

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
 * are an upper bound on time to first byte. A page passes strictly below both PASS
 * limits and fails at the FAIL size: Googlebot stops reading a document at 2 MB, and the
 * fetcher caps bodies at the same size, so a truncated body is a page past the cutoff.
 */
export const PAGE_WEIGHT_PASS = { bytes: 1_000_000, ms: 3_000 };
export const PAGE_WEIGHT_FAIL = { bytes: 2_000_000 };

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
    thresholds: { pass: PAGE_WEIGHT_PASS, fail: PAGE_WEIGHT_FAIL },
  };
  const subject =
    sampled === 'home' ? 'the home page (no product pages sampled)' : 'a sampled product page';
  const measured = `largest ${kilobytes(largest)}, slowest response time ${slowest} ms`;
  if (largest >= PAGE_WEIGHT_FAIL.bytes || truncated) {
    return fail(
      `${subject} reaches the 2 MB cutoff after which Googlebot reads nothing, so anything placed late in the HTML is not indexed (${measured})`,
      evidence,
    );
  }
  if (largest >= PAGE_WEIGHT_PASS.bytes || slowest >= PAGE_WEIGHT_PASS.ms) {
    return warn(`${subject} is 1 MB or more or took 3 s or more to answer (${measured})`, evidence);
  }
  return pass(
    `${sampled === 'home' ? subject : 'every sampled product page'} is under 1 MB and answered in under 3 s (${measured})`,
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

function isAbsoluteHttpUrl(href: string): boolean {
  return /^https?:\/\//i.test(href.trim());
}

/**
 * A URL as the index compares it: no fragment, lower-cased host, default port dropped
 * (the URL parser does the last two). Path and query stay as written, since /mug and
 * /mug/ are different documents to a crawler.
 */
function normalizedUrl(url: string): string | null {
  const parsed = parseUrl(url);
  if (parsed === null) return null;
  parsed.hash = '';
  parsed.hostname = parsed.hostname.toLowerCase();
  return parsed.href;
}

function parseUrl(url: string): URL | null {
  try {
    return new URL(url);
  } catch {
    return null;
  }
}

/** The first canonical problem of one page, in the order the verdict reports them. */
type CanonicalIssue =
  'missing' | 'conflicting' | 'relative' | 'other_origin' | 'http_downgrade' | 'not_self';

interface CanonicalPage {
  canonical: string | null;
  canonical_count: number;
  header_canonical: string | null;
  source: 'html' | 'header' | 'both' | null;
  self_referencing: boolean;
  same_origin: boolean;
  absolute: boolean;
  hreflang: string[];
  x_default: boolean;
  relative_alternates: number;
}

/**
 * Classifies one page's canonicals. `raw` holds the values as written (HTML first, then
 * the Link header), `resolved` the same values made absolute against the page URL.
 */
function canonicalIssue(
  raw: string[],
  resolved: (string | null)[],
  page: { url: string; origin: string; host: string },
): { issue: CanonicalIssue | null; sameOrigin: boolean; self: boolean } {
  if (raw.length === 0) return { issue: 'missing', sameOrigin: false, self: false };
  const distinct = new Set(resolved.map((href, index) => href ?? `unparsable:${raw[index]}`));
  const first = resolved[0];
  const parsed = first ? parseUrl(first) : null;
  const sameOrigin = parsed?.origin === page.origin;
  const sameHost = parsed !== null && parsed.host.toLowerCase() === page.host.toLowerCase();
  const downgrade = parsed !== null && parsed.protocol === 'http:' && /^https:/i.test(page.url);
  const self =
    first !== null && first !== undefined && normalizedUrl(first) === normalizedUrl(page.url);
  const issue: CanonicalIssue | null =
    distinct.size > 1
      ? 'conflicting'
      : !raw.every(isAbsoluteHttpUrl)
        ? 'relative'
        : !sameHost
          ? 'other_origin'
          : downgrade
            ? 'http_downgrade'
            : !self
              ? 'not_self'
              : null;
  return { issue, sameOrigin, self };
}

export const canonicalAndHreflang = defineCheck('A3.4', async ({ target, fetcher }) => {
  if (target.sampled.products.length === 0) {
    return skip('not_applicable', 'no product pages sampled');
  }
  const perPage: Record<string, CanonicalPage> = {};
  const issues: Record<CanonicalIssue, number> = {
    missing: 0,
    conflicting: 0,
    relative: 0,
    other_origin: 0,
    http_downgrade: 0,
    not_self: 0,
  };
  let withHreflang = 0;
  let relativeAlternates = 0;
  let thinHreflang = 0;
  const languages = new Set<string>();
  const targetHost = new URL(target.origin).host;
  for (const url of target.sampled.products) {
    const response = await fetcher.fetch(url);
    const doc = new HtmlDocument(response.body);
    const pageUrl = response.finalUrl || url;
    const links = doc.links();
    const htmlCanonicals = links
      .filter((link) => hasRel(link.rel, 'canonical'))
      .map((link) => link.href.trim());
    const headerCanonicals = parseLinkHeader(response.headers.link)
      .filter((link) => hasLinkRelation(link, 'canonical'))
      .map((link) => link.href.trim());
    const raw = [...htmlCanonicals, ...headerCanonicals];
    const resolved = raw.map((href) => resolveUrl(href, pageUrl));
    const { issue, sameOrigin, self } = canonicalIssue(raw, resolved, {
      url: pageUrl,
      origin: target.origin,
      host: targetHost,
    });
    if (issue !== null) issues[issue] += 1;

    const alternates = links.filter((link) => hasRel(link.rel, 'alternate') && link.hreflang);
    const codes = alternates.map((link) => (link.hreflang ?? '').trim().toLowerCase());
    const xDefault = codes.includes('x-default');
    const pageLanguages = [...new Set(codes.filter((code) => code !== 'x-default'))].sort();
    for (const code of pageLanguages) languages.add(code);
    const relativeHere = alternates.filter((link) => !isAbsoluteHttpUrl(link.href)).length;
    if (alternates.length > 0) {
      withHreflang += 1;
      relativeAlternates += relativeHere;
      if (!xDefault && pageLanguages.length < 2) thinHreflang += 1;
    }
    perPage[url] = {
      canonical: resolved[0] ?? raw[0] ?? null,
      canonical_count: raw.length,
      header_canonical: headerCanonicals[0] ?? null,
      source:
        htmlCanonicals.length > 0 && headerCanonicals.length > 0
          ? 'both'
          : htmlCanonicals.length > 0
            ? 'html'
            : headerCanonicals.length > 0
              ? 'header'
              : null,
      self_referencing: self,
      same_origin: sameOrigin,
      absolute: raw.length > 0 && raw.every(isAbsoluteHttpUrl),
      hreflang: pageLanguages,
      x_default: xDefault,
      relative_alternates: relativeHere,
    };
  }
  const total = target.sampled.products.length;
  const evidence = {
    pages: perPage,
    total,
    missing: issues.missing,
    issues,
    hreflang_pages: withHreflang,
    relative_alternates: relativeAlternates,
    languages: [...languages].sort(),
  };
  const pages = (count: number) => `${count} of ${total} sampled product page(s)`;
  if (issues.missing > 0) {
    return fail(
      `${pages(issues.missing)} carry no rel=canonical in the HTML or the Link header`,
      evidence,
    );
  }
  if (issues.conflicting > 0) {
    return warn(
      `${pages(issues.conflicting)} carry several or conflicting rel=canonical values, so the index picks one itself`,
      evidence,
    );
  }
  if (issues.relative > 0) {
    return warn(
      `rel=canonical on ${pages(issues.relative)} is a relative URL instead of an absolute one`,
      evidence,
    );
  }
  if (issues.other_origin > 0) {
    return warn(
      `rel=canonical on ${pages(issues.other_origin)} points to another origin`,
      evidence,
    );
  }
  if (issues.http_downgrade > 0) {
    return warn(
      `rel=canonical on ${pages(issues.http_downgrade)} names http:// while the page is served over https://`,
      evidence,
    );
  }
  if (issues.not_self > 0) {
    const example = Object.values(perPage).find((page) => !page.self_referencing);
    return warn(
      `rel=canonical on ${pages(issues.not_self)} names a different URL, so the sampled page is a duplicate of ${example?.canonical ?? 'another URL'} and that one is what gets indexed`,
      evidence,
    );
  }
  if (withHreflang > 0 && withHreflang < total) {
    return warn(
      `hreflang alternates on ${withHreflang} of ${total} sampled product page(s) only`,
      evidence,
    );
  }
  if (relativeAlternates > 0) {
    return warn(
      `${relativeAlternates} hreflang alternate(s) use a relative URL instead of an absolute one`,
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
    `rel=canonical on every sampled product page is absolute and names the page itself${hreflangNote}`,
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

/** The other host a shop is reached under: www. for an apex, the apex for a www. host. */
export function otherHostVariant(hostname: string): string {
  return hostname.toLowerCase().startsWith('www.') ? hostname.slice(4) : `www.${hostname}`;
}

function originOf(url: string): string | null {
  try {
    return new URL(url).origin;
  } catch {
    return null;
  }
}

interface HostVariant {
  url: string;
  status: number;
  final_url: string;
  redirects: number;
  /** True when nothing answered (DNS, TLS or network error): recorded, never judged. */
  unreachable: boolean;
  lands_on_origin: boolean;
  error?: string;
}

export const productUrlsAnswerDirectly = defineCheck('A3.7', async ({ target, fetcher }) => {
  const sampled = target.sampled.products.length > 0 ? 'products' : 'home';
  const responses: FetchedResponse[] = [];
  if (sampled === 'products') {
    for (const url of target.sampled.products) responses.push(await fetcher.fetch(url));
  } else {
    responses.push(target.home);
  }
  const products: Record<
    string,
    { status: number; redirects: number; final_url: string; error?: string }
  > = {};
  let downgraded = 0;
  let tooMany = 0;
  let redirected = 0;
  let longest = 0;
  let unreachable = 0;
  let wrongStatus: number | null = null;
  let wrongStatusCount = 0;
  for (const response of responses) {
    products[response.url] = {
      status: response.status,
      redirects: response.redirects,
      final_url: response.finalUrl,
      ...(response.error !== undefined ? { error: response.error } : {}),
    };
    if (response.status === 0) {
      // The fetcher gives up after its redirect limit with status 0 and an error naming it.
      if (/redirects/i.test(response.error ?? '')) tooMany += 1;
      else unreachable += 1;
      continue;
    }
    if (/^https:/i.test(response.url) && /^http:/i.test(response.finalUrl)) downgraded += 1;
    if (response.redirects > 0) {
      redirected += 1;
      longest = Math.max(longest, response.redirects);
    } else if (response.status !== 200) {
      wrongStatus ??= response.status;
      wrongStatusCount += 1;
    }
  }

  const probeVariant = async (url: string): Promise<HostVariant> => {
    const response = await fetcher.fetch(url);
    const reachable = response.status !== 0;
    return {
      url,
      status: response.status,
      final_url: response.finalUrl,
      redirects: response.redirects,
      unreachable: !reachable,
      lands_on_origin: reachable && originOf(response.finalUrl) === target.origin,
      ...(response.error !== undefined ? { error: response.error } : {}),
    };
  };
  const httpVariant = await probeVariant(`http://${target.hostname}/`);
  const otherHost = await probeVariant(`https://${otherHostVariant(target.hostname)}/`);
  const variants = [httpVariant, otherHost];

  const total = responses.length;
  const evidence = {
    sampled,
    origin: target.origin,
    products,
    variants: { http: httpVariant, other_host: otherHost },
    redirected,
    longest_chain: longest,
    unreachable,
  };
  const subject =
    sampled === 'home' ? 'the home page (no product pages sampled)' : 'every sampled product URL';
  const urls = (count: number) =>
    sampled === 'home' ? subject : `${count} of ${total} sampled product URL(s)`;
  const verb = sampled === 'home' ? 's' : '';
  if (downgraded > 0) {
    return fail(`${urls(downgraded)} redirect${verb} from https:// to http://`, evidence);
  }
  if (tooMany > 0) {
    return fail(
      `${urls(tooMany)} redirect${verb} more times than the scanner follows (Google stops at ten hops)`,
      evidence,
    );
  }
  if (unreachable === total) {
    return skip('error', `${subject} could not be fetched`, evidence);
  }
  if (redirected > 0) {
    const chain = longest > 1 ? ` through up to ${longest} hops` : '';
    return warn(
      `${urls(redirected)} redirect${verb}${chain} before answering, so the sitemap or link should name the final URL`,
      evidence,
    );
  }
  if (wrongStatusCount > 0 && wrongStatus !== null) {
    return warn(
      `${urls(wrongStatusCount)} answer${verb} HTTP ${wrongStatus} instead of 200`,
      evidence,
    );
  }
  for (const variant of variants) {
    if (variant.unreachable || variant.lands_on_origin) continue;
    if (variant.status === 200) {
      return warn(
        `${variant.url} answers 200 with its own content instead of redirecting to ${target.origin}, so the index holds duplicates`,
        evidence,
      );
    }
    return warn(
      `${variant.url} answers HTTP ${variant.status} at ${variant.final_url} instead of redirecting to ${target.origin}`,
      evidence,
    );
  }
  const redirecting = variants.filter((variant) => variant.lands_on_origin);
  const silent = variants.filter((variant) => variant.unreachable);
  const redirectNote =
    redirecting.length > 0
      ? ` and ${redirecting.map((variant) => variant.url).join(' and ')} redirect${redirecting.length === 1 ? 's' : ''} to ${target.origin}`
      : '';
  const silentNote =
    silent.length > 0
      ? ` (${silent.map((variant) => variant.url).join(' and ')} did not answer)`
      : '';
  return pass(`${subject} answers 200 at its own address${redirectNote}${silentNote}`, evidence);
});

/** Titles shorter than this cannot identify a page in a citation. */
const TITLE_MIN_LENGTH = 10;

function titleKey(title: string): string {
  return title.replace(/\s+/g, ' ').trim().toLowerCase();
}

interface TitledPage {
  kind: 'home' | 'listing' | 'product';
  title: string | null;
  title_length: number;
  description_present: boolean;
  description_length: number;
}

export const titleAndDescriptionPresent = defineCheck('A3.8', async ({ target, fetcher }) => {
  const docs: { url: string; kind: TitledPage['kind']; doc: HtmlDocument }[] = [
    { url: target.sampled.home, kind: 'home', doc: target.homeDoc },
  ];
  // Only pages that answered are judged: a 404 or an unreachable page has no title to
  // cite, and its status is A3.6's and A3.7's business. They are recorded, not scored.
  const unavailable: Record<string, number> = {};
  if (target.sampled.listing) {
    const response = await fetcher.fetch(target.sampled.listing);
    if (isOk(response)) {
      docs.push({
        url: target.sampled.listing,
        kind: 'listing',
        doc: new HtmlDocument(response.body),
      });
    } else {
      unavailable[target.sampled.listing] = response.status;
    }
  }
  for (const page of await productPages(target, fetcher)) {
    if (page.status >= 200 && page.status < 300) {
      docs.push({ url: page.url, kind: 'product', doc: page.doc });
    } else {
      unavailable[page.url] = page.status;
    }
  }
  const perPage: Record<string, TitledPage> = {};
  const byTitle = new Map<string, string[]>();
  let untitled = 0;
  let short = 0;
  let undescribed = 0;
  for (const { url, kind, doc } of docs) {
    const trimmedTitle = doc.title()?.trim() ?? '';
    const title = trimmedTitle === '' ? null : trimmedTitle;
    const description = doc.meta('description')?.trim() ?? '';
    perPage[url] = {
      kind,
      title,
      title_length: title?.length ?? 0,
      description_present: description.length > 0,
      description_length: description.length,
    };
    if (title === null) {
      untitled += 1;
    } else {
      if (title.length < TITLE_MIN_LENGTH) short += 1;
      const key = titleKey(title);
      byTitle.set(key, [...(byTitle.get(key) ?? []), url]);
    }
    if (description.length === 0) undescribed += 1;
  }
  const duplicates = [...byTitle.values()]
    .filter((urls) => urls.length > 1)
    .map((urls) => perPage[urls[0] ?? '']?.title ?? '')
    .filter(Boolean);
  const total = docs.length;
  const evidence = {
    pages: perPage,
    total,
    untitled,
    short_titles: short,
    undescribed,
    duplicates,
    unavailable,
  };
  const pages = (count: number) => `${count} of ${total} sampled page(s)`;
  if (untitled > 0) {
    return fail(`${pages(untitled)} have no title element or an empty one`, evidence);
  }
  if (duplicates.length > 0) {
    return warn(
      `${duplicates.length} title(s) are shared by several sampled pages, starting with "${duplicates[0] ?? ''}"`,
      evidence,
    );
  }
  if (short > 0) {
    return warn(
      `${pages(short)} have a title shorter than ${TITLE_MIN_LENGTH} characters`,
      evidence,
    );
  }
  if (undescribed > 0) {
    return warn(`${pages(undescribed)} have no meta description or an empty one`, evidence);
  }
  return pass(
    `all ${total} sampled page(s) carry a distinct title and a meta description`,
    evidence,
  );
});

export const conditionalRequestsSupported = defineCheck('A3.9', async ({ target, fetcher }) => {
  const productUrl = target.sampled.products[0];
  // The home page response is on the target already; the product page is cached by now.
  const response = productUrl === undefined ? target.home : await fetcher.fetch(productUrl);
  const url = productUrl ?? target.sampled.home;
  const what =
    productUrl === undefined ? 'the home page (no product pages sampled)' : 'the product page';
  const etag = response.headers.etag ?? null;
  const lastModified = response.headers['last-modified'] ?? null;
  const evidence: Record<string, unknown> = {
    url,
    etag,
    last_modified: lastModified,
    conditional_header_sent: null,
    conditional_status: null,
  };
  if (response.status === 0) {
    return skip(
      'error',
      `${what} could not be fetched: ${response.error ?? 'no response'}`,
      evidence,
    );
  }
  if (etag === null && lastModified === null) {
    return warn(
      `${what} sends no ETag or Last-Modified header, so a crawler must download it again to see whether it changed`,
      evidence,
    );
  }
  const header = etag !== null ? 'if-none-match' : 'if-modified-since';
  const validator = etag !== null ? 'ETag' : 'Last-Modified';
  evidence.conditional_header_sent = header;
  const conditional = await fetcher.fetch(url, {
    headers: { [header]: etag ?? lastModified ?? '' },
  });
  evidence.conditional_status = conditional.status;
  if (conditional.status === 0) {
    return skip(
      'error',
      `the conditional request for ${what} failed: ${conditional.error ?? 'no response'}`,
      evidence,
    );
  }
  if (conditional.status === 304) {
    return pass(
      `${what} answers 304 Not Modified to a conditional request with its ${validator}`,
      evidence,
    );
  }
  if (conditional.status === 200) {
    return warn(
      `${what} sends a ${validator} but answers 200 to a request that repeats it, so the validator is ignored`,
      evidence,
    );
  }
  return warn(
    `${what} answers HTTP ${conditional.status} instead of 304 to a conditional request with its ${validator}`,
    evidence,
  );
});

export interface ViewportReading {
  viewport: string | null;
  device_width: boolean;
  fixed_width: boolean;
  zoom_blocked: boolean;
}

/** Reads a meta viewport content value; tolerant of case, spaces and either separator. */
export function readViewport(content: string | null): ViewportReading {
  const properties = new Map<string, string>();
  for (const part of (content ?? '').split(/[,;]/)) {
    const [name, ...rest] = part.split('=');
    const key = name?.trim().toLowerCase();
    if (key) properties.set(key, rest.join('=').trim().toLowerCase());
  }
  const width = properties.get('width') ?? '';
  const scalable = properties.get('user-scalable') ?? '';
  const maximum = Number.parseFloat(properties.get('maximum-scale') ?? '');
  return {
    viewport: content,
    device_width: width === 'device-width',
    fixed_width: /^\d+(?:px)?$/.test(width),
    zoom_blocked: scalable === 'no' || scalable === '0' || (!Number.isNaN(maximum) && maximum < 1),
  };
}

export const mobileViewportDeclared = defineCheck('A3.10', async ({ target, fetcher }) => {
  const sampled = target.sampled.products.length > 0 ? 'products' : 'home';
  const docs: { url: string; doc: HtmlDocument }[] =
    sampled === 'products'
      ? await productPages(target, fetcher)
      : [{ url: target.sampled.home, doc: target.homeDoc }];
  const perPage: Record<string, ViewportReading> = {};
  let missing = 0;
  let fixed = 0;
  let zoomBlocked = 0;
  for (const { url, doc } of docs) {
    const reading = readViewport(doc.meta('viewport'));
    perPage[url] = reading;
    if (reading.viewport === null || reading.viewport.trim() === '') missing += 1;
    else if (!reading.device_width || reading.fixed_width) fixed += 1;
    if (reading.zoom_blocked) zoomBlocked += 1;
  }
  const total = docs.length;
  const evidence = {
    sampled,
    pages: perPage,
    total,
    missing,
    fixed_width: fixed,
    zoom_blocked: zoomBlocked,
  };
  const pages = (count: number) =>
    sampled === 'home'
      ? 'the home page (no product pages sampled) declares'
      : `${count} of ${total} sampled product page(s) declare`;
  if (missing > 0) {
    return warn(`${pages(missing)} no meta viewport`, evidence);
  }
  if (fixed > 0) {
    return warn(`${pages(fixed)} a viewport without width=device-width`, evidence);
  }
  if (zoomBlocked > 0) {
    return warn(
      `${pages(zoomBlocked)} a viewport that forbids zooming (user-scalable=no or maximum-scale below 1)`,
      evidence,
    );
  }
  return pass(
    `${sampled === 'home' ? 'the home page (no product pages sampled)' : 'every sampled product page'} declares width=device-width`,
    evidence,
  );
});
