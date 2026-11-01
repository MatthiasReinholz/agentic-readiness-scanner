import type { Element } from 'domhandler';
import { registrableDomain } from '../../http/domain.js';

import { contentType, isOk, type FetchedResponse, type FetchOptions } from '../../http/types.js';
import { attribute, HtmlDocument } from '../../parsers/html.js';
import { extractJsonLd, offersOf, productNodes, asString } from '../../parsers/jsonld.js';
import { hasPriceText } from '../../parsers/price.js';
import { hasLinkRelation, mediaTypeOf, parseLinkHeader } from '../../parsers/link-header.js';
import { fnv1a32 } from '../../target/sampling.js';
import type { Fetcher } from '../../http/types.js';
import type { Target } from '../../target/types.js';
import {
  describeFailure,
  looksLikeProductPage,
  pathOf,
  readableProductPages,
  type ProductPage,
} from '../shared.js';
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

/**
 * Statuses that say nothing about the resource: the server throttled the scanner or a
 * gateway failed. A probe that meets one is inconclusive, never a verdict.
 */
export const TRANSIENT_STATUSES = new Set([429, 502, 503, 504]);

export function isTransient(response: Pick<FetchedResponse, 'status'>): boolean {
  return response.status === 0 || TRANSIENT_STATUSES.has(response.status);
}

export interface SampledProductPages {
  /** The sampled product pages that answered 2xx: the ones a check may judge. */
  pages: ProductPage[];
  /** The outcome to return when none can be judged; null when `pages` is not empty. */
  unavailable: CheckOutcome | null;
  /** Sampled pages that could not be read, with the status and the reason, by URL. */
  failed: Record<string, { status: number; failure: string }>;
  /** Appended to a message: '', or '; 1 sampled product page could not be fetched (HTTP 503)'. */
  note: string;
}

/**
 * The sampled product pages a content check judges, plus what it says about the ones it
 * could not read. A page that answered 0, 4xx or 5xx is recorded and named, never scored
 * as empty, malformed or missing.
 */
export async function sampledProductPages(
  target: Target,
  fetcher: Fetcher,
): Promise<SampledProductPages> {
  const { pages, unavailable } = await readableProductPages(target, fetcher);
  const readable = new Set(pages.map((page) => page.url));
  const failed: SampledProductPages['failed'] = {};
  for (const url of target.sampled.products) {
    if (readable.has(url)) continue;
    // Cached by the fetcher: readableProductPages fetched it a moment ago.
    const response = await fetcher.fetch(url);
    failed[url] = { status: response.status, failure: describeFailure(response) };
  }
  const count = Object.keys(failed).length;
  const reasons = [...new Set(Object.values(failed).map((entry) => entry.failure))].join(', ');
  const note =
    count === 0
      ? ''
      : `; ${count} sampled product ${count === 1 ? 'page' : 'pages'} could not be fetched (${reasons})`;
  return { pages, unavailable, failed, note };
}

/**
 * The pages a check judged, as a sentence subject: "the home page" when no product pages
 * were sampled, "the sampled product page" for a sample of one, else "2 of 3 sampled
 * product pages". `plural` says which verb form follows.
 */
export function judgedPages(
  sampled: 'home' | 'products',
  count: number,
  total: number,
): { phrase: string; plural: boolean } {
  if (sampled === 'home') return { phrase: 'the home page', plural: false };
  if (total === 1) return { phrase: 'the sampled product page', plural: false };
  return { phrase: `${count} of ${total} sampled product pages`, plural: count !== 1 };
}

/** "every sampled product page", "the sampled product page" or "the home page". */
export function everyJudgedPage(sampled: 'home' | 'products', total: number): string {
  if (sampled === 'home') return 'the home page';
  return total === 1 ? 'the sampled product page' : 'every sampled product page';
}

/**
 * The pages a check that falls back to the home page judges: the readable sampled product
 * pages, or the home page when none were sampled. `unavailable` is set when product pages
 * were sampled but none could be read.
 */
async function judgedDocuments(
  target: Target,
  fetcher: Fetcher,
): Promise<{
  sampled: 'home' | 'products';
  docs: { url: string; doc: HtmlDocument }[];
  unavailable: CheckOutcome | null;
  failed: SampledProductPages['failed'];
  note: string;
}> {
  if (target.sampled.products.length === 0) {
    return {
      sampled: 'home',
      docs: [{ url: target.home.finalUrl, doc: target.homeDoc }],
      unavailable: null,
      failed: {},
      note: '',
    };
  }
  const { pages, unavailable, failed, note } = await sampledProductPages(target, fetcher);
  return { sampled: 'products', docs: pages, unavailable, failed, note };
}

/**
 * The path of a sign-in, registration or storefront password page a product URL may be
 * redirected to (Shopify's /password, WooCommerce's /my-account/, generic /login).
 * Tested against the final URL only when the product URL redirected: a product named
 * "Password Journal" at its own address is a product.
 */
const SIGN_IN_PATH = /login|signin|sign-in|password|account\/login|my-account/i;
const SIGN_IN_SPEC = 'https://support.google.com/merchants/answer/6324416';

/**
 * True when what answered a product URL is a sign-in or password page rather than the
 * product: the URL was redirected to a sign-in path, or the document is a password form
 * with no product content at all. A product page that merely links to the account area,
 * or carries a login form in its header next to the product, is a product page.
 */
export function isSignInPage(doc: HtmlDocument, requestedUrl: string, finalUrl: string): boolean {
  const redirected = finalUrl !== '' && finalUrl !== requestedUrl;
  if (redirected && SIGN_IN_PATH.test(pathOf(finalUrl))) return true;
  const passwordForm = doc
    .controls()
    .some((control) => control.tag === 'input' && control.type?.toLowerCase() === 'password');
  return passwordForm && !looksLikeProductPage(doc);
}

export const serverRenderedProductContent = defineCheck('A3.2', async ({ target, fetcher }) => {
  const { pages, unavailable, failed, note } = await sampledProductPages(target, fetcher);
  if (unavailable) return unavailable;
  const perPage: Record<
    string,
    { title: boolean; price: boolean; description: boolean; words: number }
  > = {};
  // A product URL that lands on a sign-in or password page has no product content to
  // judge: Google's landing-page rules forbid requiring registration or sign-in, and
  // Shopify's password page makes a store ineligible for agentic storefronts.
  const signIn: Record<string, string> = {};
  for (const page of pages) {
    const response = await fetcher.fetch(page.url);
    if (isSignInPage(page.doc, page.url, response.finalUrl)) {
      signIn[page.url] = response.finalUrl || page.url;
    }
  }
  const firstSignIn = Object.entries(signIn)[0];
  if (firstSignIn) {
    const { phrase, plural } = judgedPages('products', Object.keys(signIn).length, pages.length);
    return fail(
      `${phrase.replace('page', 'URL')} ${plural ? 'redirect' : 'redirects'} to a sign-in or password page (${firstSignIn[1]}); Google's landing-page rules say a product page must not require registration or sign-in, and Shopify's password page makes a store ineligible for agentic storefronts${note}`,
      {
        pages: perPage,
        complete: 0,
        total: pages.length,
        failed,
        sign_in: signIn,
        spec: SIGN_IN_SPEC,
      },
    );
  }
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
    `${complete} of ${pages.length} sampled product page(s) carry title, price and description in raw HTML${note}`,
    { pages: perPage, complete, total: pages.length, failed },
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
  let failed: SampledProductPages['failed'] = {};
  let note = '';
  if (sampled === 'products') {
    const judged = await sampledProductPages(target, fetcher);
    if (judged.unavailable) return judged.unavailable;
    ({ failed, note } = judged);
    // Only pages that answered are measured; the fetcher has them cached.
    for (const page of judged.pages) responses.push(await fetcher.fetch(page.url));
  } else {
    responses.push(target.home);
  }
  const perPage: Record<
    string,
    { status: number; bytes: number; response_ms: number; truncated: boolean }
  > = {};
  let largest: FetchedResponse | null = null;
  let slowest: FetchedResponse | null = null;
  let truncated: FetchedResponse | null = null;
  for (const response of responses) {
    perPage[response.url] = {
      status: response.status,
      bytes: response.bytes,
      response_ms: response.durationMs,
      truncated: response.truncated,
    };
    if (largest === null || response.bytes > largest.bytes) largest = response;
    if (slowest === null || response.durationMs > slowest.durationMs) slowest = response;
    if (response.truncated) truncated ??= response;
  }
  const evidence = {
    sampled,
    pages: perPage,
    largest_bytes: largest?.bytes ?? 0,
    slowest_response_ms: slowest?.durationMs ?? 0,
    // A truncated body means the fetcher stopped reading; its size is a lower bound.
    truncated: truncated !== null,
    thresholds: { pass: PAGE_WEIGHT_PASS, fail: PAGE_WEIGHT_FAIL },
    failed,
  };
  const name = (response: FetchedResponse) =>
    sampled === 'home' ? 'the home page' : `the sampled product page ${response.url}`;
  const cutoff =
    truncated ?? (largest !== null && largest.bytes >= PAGE_WEIGHT_FAIL.bytes ? largest : null);
  if (cutoff !== null) {
    return fail(
      `${name(cutoff)} reaches the 2 MB cutoff after which Googlebot reads nothing (${kilobytes(cutoff.bytes)}${cutoff.truncated ? ' read before the scanner stopped' : ''}), so anything placed late in the HTML is not indexed${note}`,
      evidence,
    );
  }
  const reasons: string[] = [];
  if (largest !== null && largest.bytes >= PAGE_WEIGHT_PASS.bytes) {
    reasons.push(`${name(largest)} is ${kilobytes(largest.bytes)} of HTML, 1 MB or more`);
  }
  if (slowest !== null && slowest.durationMs >= PAGE_WEIGHT_PASS.ms) {
    reasons.push(`${name(slowest)} took ${slowest.durationMs} ms to answer, 3 s or more`);
  }
  if (reasons.length > 0) {
    return warn(`${reasons.join(' and ')}${note}`, evidence);
  }
  return pass(
    `${everyJudgedPage(sampled, responses.length)} is under 1 MB and answered in under 3 s (largest ${kilobytes(largest?.bytes ?? 0)}, slowest response time ${slowest?.durationMs ?? 0} ms)${note}`,
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
  const { pages: readable, unavailable, failed, note } = await sampledProductPages(target, fetcher);
  if (unavailable) return unavailable;
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
  for (const { url, doc } of readable) {
    // Cached: the headers and the final URL of the page sampledProductPages read.
    const response = await fetcher.fetch(url);
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
  const total = readable.length;
  const evidence = {
    pages: perPage,
    total,
    missing: issues.missing,
    issues,
    hreflang_pages: withHreflang,
    relative_alternates: relativeAlternates,
    languages: [...languages].sort(),
    failed,
  };
  const pages = (count: number) => `${count} of ${total} sampled product page(s)`;
  if (issues.missing > 0) {
    return fail(
      `${pages(issues.missing)} carry no rel=canonical in the HTML or the Link header${note}`,
      evidence,
    );
  }
  if (issues.conflicting > 0) {
    return warn(
      `${pages(issues.conflicting)} carry several or conflicting rel=canonical values, so the index picks one itself${note}`,
      evidence,
    );
  }
  if (issues.relative > 0) {
    return warn(
      `rel=canonical on ${pages(issues.relative)} is a relative URL instead of an absolute one${note}`,
      evidence,
    );
  }
  if (issues.other_origin > 0) {
    return warn(
      `rel=canonical on ${pages(issues.other_origin)} points to another origin${note}`,
      evidence,
    );
  }
  if (issues.http_downgrade > 0) {
    return warn(
      `rel=canonical on ${pages(issues.http_downgrade)} names http:// while the page is served over https://${note}`,
      evidence,
    );
  }
  if (issues.not_self > 0) {
    const example = Object.values(perPage).find((page) => !page.self_referencing);
    return warn(
      `rel=canonical on ${pages(issues.not_self)} names a different URL, so the sampled page is a duplicate of ${example?.canonical ?? 'another URL'} and that one is what gets indexed${note}`,
      evidence,
    );
  }
  if (withHreflang > 0 && withHreflang < total) {
    return warn(
      `hreflang alternates on ${withHreflang} of ${total} sampled product page(s) only${note}`,
      evidence,
    );
  }
  if (relativeAlternates > 0) {
    return warn(
      `${relativeAlternates} hreflang alternate(s) use a relative URL instead of an absolute one${note}`,
      evidence,
    );
  }
  if (thinHreflang > 0) {
    return warn(
      `hreflang alternates on ${thinHreflang} page(s) name fewer than two languages and no x-default${note}`,
      evidence,
    );
  }
  const hreflangNote =
    withHreflang > 0 ? ` with hreflang alternates for ${[...languages].sort().join(', ')}` : '';
  return pass(
    `rel=canonical on ${everyJudgedPage('products', total)} is absolute and names the page itself${hreflangNote}${note}`,
    evidence,
  );
});

/**
 * Cookie and consent banners as themes and consent platforms name them: cookie, consent,
 * gdpr, privacy-banner and cmp (consent management platform, as a token). Generic words
 * such as modal, overlay or popup are not matched: a cart drawer's backdrop, a closed
 * country picker or a header wrapper carries them too and is not a consent overlay.
 * Class and id values are matched against literal alternatives only, so the test stays
 * linear.
 */
const OVERLAY_NAME = /cookie|consent|gdpr|privacy-banner|(?:^|[^a-z0-9])cmp(?![a-z])/i;
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
  const { sampled, docs, unavailable, failed, note } = await judgedDocuments(target, fetcher);
  if (unavailable) return unavailable;
  const perPage: Record<string, { main_landmark: boolean; overlay_before_main: string | null }> =
    {};
  let missing = 0;
  let overlaid = 0;
  let firstOverlay: string | null = null;
  for (const { url, doc } of docs) {
    const main = doc.mainLandmark();
    const overlay = doc.firstElement(looksLikeOverlay);
    const overlayBefore = main !== null && overlay !== null && doc.precedes(overlay, main);
    const described = overlayBefore && overlay ? describe(overlay) : null;
    perPage[url] = { main_landmark: main !== null, overlay_before_main: described };
    if (main === null) missing += 1;
    if (described !== null) {
      overlaid += 1;
      firstOverlay ??= described;
    }
  }
  const total = docs.length;
  const evidence = { sampled, pages: perPage, total, missing_main: missing, overlaid, failed };
  // Weight 1 and a heuristic: a missing or overlaid landmark warns, never fails.
  if (missing > 0) {
    const { phrase, plural } = judgedPages(sampled, missing, total);
    return warn(`${phrase} ${plural ? 'have' : 'has'} no main landmark${note}`, evidence);
  }
  if (overlaid > 0 && firstOverlay !== null) {
    const { phrase } = judgedPages(sampled, overlaid, total);
    return warn(
      `a cookie or consent banner (${firstOverlay}) precedes the main landmark on ${phrase}${note}`,
      evidence,
    );
  }
  return pass(
    `main landmark present on ${everyJudgedPage(sampled, total)} with no cookie or consent banner before it${note}`,
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

/**
 * True when a body labelled text/markdown is HTML: it opens with a tag, or carries a
 * doctype or <html> near the top. Real converted Markdown (Cloudflare's Markdown for
 * Agents, for one) starts with YAML front matter or a heading and never with a tag.
 */
export function isHtmlLabelledAsMarkdown(body: string): boolean {
  const head = body.slice(0, 2000);
  return head.trimStart().startsWith('<') || /<!doctype\s|<html[\s>]/i.test(head);
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
      html_body: isMarkdown(negotiated) ? isHtmlLabelledAsMarkdown(negotiated.body) : null,
    },
    alternate: null,
    md: null,
    outcome: 'none',
  };
  if (isMarkdown(negotiated) && isHtmlLabelledAsMarkdown(negotiated.body)) {
    evidence.outcome = 'mislabelled';
    return fail(
      'the product page answers Accept: text/markdown with a response labelled text/markdown whose body is HTML (it opens with a tag), so agents asking for Markdown get mislabelled HTML',
      evidence,
    );
  }
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
    const mislabelled = markdown && isHtmlLabelledAsMarkdown(response.body);
    const named = markdown && !mislabelled && namesPage(response.body, names);
    evidence[label] = {
      url: probeUrl,
      status: response.status,
      content_type: contentType(response),
      names_product: markdown ? named : null,
      html_body: markdown ? mislabelled : null,
    };
    if (mislabelled) {
      evidence.outcome = 'mislabelled';
      return fail(
        `${label === 'alternate' ? 'the Markdown alternate' : 'the .md neighbour'} ${probeUrl} is labelled text/markdown but its body is HTML (it opens with a tag), so agents asking for Markdown get mislabelled HTML`,
        evidence,
      );
    }
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
  // A throttled or failed probe says nothing about 404 handling: a 429 is not a soft 404.
  if (isTransient(response)) {
    const why = response.status === 429 ? 'was rate limited' : 'failed';
    return skip(
      'error',
      `the 404 handling could not be judged because the probe request ${why} (${describeFailure(response)})`,
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

function hostOf(url: string): string | null {
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return null;
  }
}

/**
 * The registrable domain of a host, approximated without a public suffix list: the last
 * two labels, or the last three when the second-level label is a conventional division
 * of a two-letter country code (co.uk, com.au, co.jp). Enough to tell a sister host of
 * the same site (us.checkout.gymshark.com for gymshark.com) from an unrelated one.
 */
export { registrableDomain } from '../../http/domain.js';

interface HostVariant {
  url: string;
  status: number;
  final_url: string;
  redirects: number;
  /** True when nothing answered (DNS, TLS or network error): recorded, never judged. */
  unreachable: boolean;
  /** True when the answer says nothing about consolidation: no answer, a 429 or a gateway error. */
  inconclusive: boolean;
  lands_on_origin: boolean;
  /** The host the variant redirected to when that is neither its own host nor the origin's. */
  redirects_to_host: string | null;
  /** True when that other host shares the origin's registrable domain. */
  same_registrable_domain: boolean;
  error?: string;
}

/** "the home page", "the sampled product URL" or "2 of 3 sampled product URLs", with the verb form. */
function judgedUrls(
  sampled: 'home' | 'products',
  count: number,
  total: number,
): { phrase: string; plural: boolean } {
  if (sampled === 'home') return { phrase: 'the home page', plural: false };
  if (total === 1) return { phrase: 'the sampled product URL', plural: false };
  return { phrase: `${count} of ${total} sampled product URLs`, plural: count !== 1 };
}

function hop(response: FetchedResponse): string {
  return `${response.url} → ${response.finalUrl}`;
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
  const counts = {
    downgraded: 0,
    tooMany: 0,
    stale: 0,
    redirected: 0,
    unreachable: 0,
    wrongStatus: 0,
  };
  const examples: Partial<Record<keyof typeof counts, FetchedResponse>> = {};
  const record = (key: keyof typeof counts, response: FetchedResponse) => {
    counts[key] += 1;
    examples[key] ??= response;
  };
  // Sampled URLs the sitemap listed: one of them answering 404 or 410 is a stale entry,
  // which Google and Bing both ask publishers to remove promptly.
  const fromSitemap = new Set(target.sitemap?.productUrls ?? []);
  const staleEntries: string[] = [];
  let longest = 0;
  for (const response of responses) {
    products[response.url] = {
      status: response.status,
      redirects: response.redirects,
      final_url: response.finalUrl,
      ...(response.error !== undefined ? { error: response.error } : {}),
    };
    if (response.status === 0) {
      // The fetcher gives up after its redirect limit with status 0 and an error naming it.
      record(/redirects/i.test(response.error ?? '') ? 'tooMany' : 'unreachable', response);
      continue;
    }
    if (/^https:/i.test(response.url) && /^http:/i.test(response.finalUrl))
      record('downgraded', response);
    if (
      sampled === 'products' &&
      fromSitemap.has(response.url) &&
      (response.status === 404 || response.status === 410)
    ) {
      record('stale', response);
      staleEntries.push(response.url);
      continue;
    }
    if (response.redirects > 0) {
      record('redirected', response);
      longest = Math.max(longest, response.redirects);
    } else if (response.status !== 200) {
      record('wrongStatus', response);
    }
  }
  // When the home page stands in for product URLs, the resolver followed the input URL to
  // the origin it scans: a hop that changed the host (apex to www) is input normalization,
  // and one more hop from / to a locale or landing path (/en-US/, /de/index.html) is how
  // the site greets every visitor, not a published URL that moved. Neither is a finding.
  const home = sampled === 'home' ? responses[0] : undefined;
  const landingRedirect =
    home !== undefined &&
    home.redirects > 0 &&
    home.status !== 0 &&
    originOf(home.finalUrl) === target.origin &&
    home.redirects - (hostOf(home.url) !== hostOf(home.finalUrl) ? 1 : 0) <= 1;

  const originDomain = registrableDomain(target.hostname);
  const probeVariant = async (url: string): Promise<HostVariant> => {
    const response = await fetcher.fetch(url);
    const reachable = response.status !== 0;
    const landsOnOrigin = reachable && originOf(response.finalUrl) === target.origin;
    const finalHost = hostOf(response.finalUrl);
    const redirectsToHost =
      reachable &&
      !landsOnOrigin &&
      response.redirects > 0 &&
      finalHost !== null &&
      finalHost !== hostOf(url)
        ? finalHost
        : null;
    return {
      url,
      status: response.status,
      final_url: response.finalUrl,
      redirects: response.redirects,
      unreachable: !reachable,
      inconclusive: !landsOnOrigin && redirectsToHost === null && isTransient(response),
      lands_on_origin: landsOnOrigin,
      redirects_to_host: redirectsToHost,
      same_registrable_domain:
        redirectsToHost !== null && registrableDomain(redirectsToHost) === originDomain,
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
    redirected: counts.redirected,
    longest_chain: longest,
    unreachable: counts.unreachable,
    landing_redirect: landingRedirect,
    stale_sitemap_entries: staleEntries,
  };
  const subject = (count: number) => judgedUrls(sampled, count, total);
  const s = (plural: boolean) => (plural ? '' : 's');
  if (counts.downgraded > 0 && examples.downgraded) {
    const { phrase, plural } = subject(counts.downgraded);
    return fail(
      `${phrase} redirect${s(plural)} from https:// to http:// (${hop(examples.downgraded)})`,
      evidence,
    );
  }
  if (counts.tooMany > 0 && examples.tooMany) {
    const { phrase, plural } = subject(counts.tooMany);
    return fail(
      `${phrase} redirect${s(plural)} more times than the scanner follows (Google stops at ten hops), starting from ${examples.tooMany.url}`,
      evidence,
    );
  }
  if (counts.stale > 0 && examples.stale) {
    const more =
      counts.stale > 1
        ? ` and ${counts.stale - 1} more sampled URL${counts.stale > 2 ? 's' : ''}`
        : '';
    return fail(
      `the sitemap lists ${examples.stale.url}${more}, which answer${counts.stale > 1 ? '' : 's'} HTTP ${examples.stale.status}; Google and Bing ask for sitemaps that list only live, canonical URLs`,
      evidence,
    );
  }
  if (counts.unreachable === total) {
    return skip('error', `${subject(total).phrase} could not be fetched`, evidence);
  }
  if (counts.redirected > 0 && examples.redirected && !landingRedirect) {
    const { phrase, plural } = subject(counts.redirected);
    const chain = longest > 1 ? ` through up to ${longest} hops` : '';
    return warn(
      `${phrase} redirect${s(plural)}${chain} before answering (${hop(examples.redirected)}), so the sitemap or link should name the final URL`,
      evidence,
    );
  }
  if (counts.wrongStatus > 0 && examples.wrongStatus) {
    const { phrase, plural } = subject(counts.wrongStatus);
    return warn(
      `${phrase} answer${s(plural)} HTTP ${examples.wrongStatus.status} instead of 200`,
      evidence,
    );
  }
  for (const variant of variants) {
    if (variant.inconclusive || variant.lands_on_origin) continue;
    if (variant.redirects_to_host !== null) {
      return warn(
        variant.same_registrable_domain
          ? `${variant.url} redirects to ${variant.final_url}, another host of ${originDomain}, instead of to ${target.origin}, so the site is consolidated elsewhere and the index holds two hosts`
          : `${variant.url} redirects to ${variant.final_url}, a host outside ${originDomain}, instead of to ${target.origin}`,
        evidence,
      );
    }
    const at = variant.final_url !== variant.url ? ` at ${variant.final_url}` : '';
    if (variant.status === 200) {
      return warn(
        `${variant.url} answers 200 with its own content${at} instead of redirecting to ${target.origin}, so the index holds duplicates`,
        evidence,
      );
    }
    return warn(
      `${variant.url} answers HTTP ${variant.status}${at} instead of redirecting to ${target.origin}`,
      evidence,
    );
  }
  const redirecting = variants.filter((variant) => variant.lands_on_origin);
  const inconclusive = variants.filter((variant) => variant.inconclusive);
  const redirectNote =
    redirecting.length > 0
      ? ` and ${redirecting.map((variant) => variant.url).join(' and ')} redirect${redirecting.length === 1 ? 's' : ''} to ${target.origin}`
      : '';
  const inconclusiveNote =
    inconclusive.length > 0
      ? ` (${inconclusive
          .map((variant) =>
            variant.status === 0
              ? `${variant.url} did not answer: ${variant.error ?? 'no response'}`
              : `${variant.url} answered HTTP ${variant.status}`,
          )
          .join(
            ' and ',
          )}, so ${inconclusive.length === 1 ? 'that variant is' : 'those variants are'} inconclusive)`
      : '';
  const answered =
    landingRedirect && home !== undefined
      ? `answers 200 at ${home.finalUrl} after a redirect from ${home.url}, the locale or landing redirect every visitor gets, which is not a finding,`
      : 'answers 200 at its own address';
  const every =
    sampled === 'home'
      ? 'the home page'
      : total === 1
        ? 'the sampled product URL'
        : 'every sampled product URL';
  return pass(`${every} ${answered}${redirectNote}${inconclusiveNote}`, evidence);
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
  // The home page and the listing are always judged, so a sample with no readable
  // product page is recorded here rather than returned as a skip.
  const { pages, failed, note } = await sampledProductPages(target, fetcher);
  for (const page of pages) docs.push({ url: page.url, kind: 'product', doc: page.doc });
  for (const [url, entry] of Object.entries(failed)) unavailable[url] = entry.status;
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
  const pageCount = (count: number) => `${count} of ${total} sampled page(s)`;
  if (untitled > 0) {
    return fail(`${pageCount(untitled)} have no title element or an empty one${note}`, evidence);
  }
  if (duplicates.length > 0) {
    return warn(
      `${duplicates.length} title(s) are shared by several sampled pages, starting with "${duplicates[0] ?? ''}"${note}`,
      evidence,
    );
  }
  if (short > 0) {
    return warn(
      `${pageCount(short)} have a title shorter than ${TITLE_MIN_LENGTH} characters${note}`,
      evidence,
    );
  }
  if (undescribed > 0) {
    return warn(
      `${pageCount(undescribed)} have no meta description or an empty one${note}`,
      evidence,
    );
  }
  return pass(
    `all ${total} sampled page(s) carry a distinct title and a meta description${note}`,
    evidence,
  );
});

export const conditionalRequestsSupported = defineCheck('A3.9', async ({ target, fetcher }) => {
  let response: FetchedResponse;
  let url: string;
  let what: string;
  let note = '';
  if (target.sampled.products.length === 0) {
    // The home page response is on the target already.
    response = target.home;
    url = target.sampled.home;
    what = 'the home page';
  } else {
    // The first sampled product page that answered; a page that did not is named, not judged.
    const judged = await sampledProductPages(target, fetcher);
    const first = judged.pages[0];
    if (judged.unavailable || first === undefined) {
      return judged.unavailable ?? skip('error', 'no sampled product page could be fetched');
    }
    url = first.url;
    // The plain HTML response: no Accept: text/markdown, so this is never the Markdown
    // copy A3.1 negotiated (a converted Markdown response drops ETag and Last-Modified,
    // and the fetcher caches the two requests separately by their headers).
    response = await fetcher.fetch(url);
    what = 'the product page';
    const skipped = target.sampled.products.filter((candidate) => candidate !== url);
    const skippedFailure = skipped.map((candidate) => judged.failed[candidate]).find(Boolean);
    if (skippedFailure && target.sampled.products[0] !== url) {
      note = `; the first sampled product page could not be fetched (${skippedFailure.failure}), so the next one was judged`;
    }
  }
  const etag = response.headers.etag ?? null;
  const lastModified = response.headers['last-modified'] ?? null;
  const evidence: Record<string, unknown> = {
    url,
    content_type: contentType(response),
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
      `${what} sends no ETag or Last-Modified header, so a crawler must download it again to see whether it changed${note}`,
      evidence,
    );
  }
  const header = etag !== null ? 'if-none-match' : 'if-modified-since';
  const validator = etag !== null ? 'an ETag' : 'a Last-Modified';
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
      `${what} answers 304 Not Modified to a conditional request with its ${validator.split(' ')[1] ?? validator}${note}`,
      evidence,
    );
  }
  if (conditional.status === 200) {
    return warn(
      `${what} sends ${validator} but answers 200 to a request that repeats it, so the validator is ignored${note}`,
      evidence,
    );
  }
  return warn(
    `${what} answers HTTP ${conditional.status} instead of 304 to a conditional request with its ${validator.split(' ')[1] ?? validator}${note}`,
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
  const { sampled, docs, unavailable, failed, note } = await judgedDocuments(target, fetcher);
  if (unavailable) return unavailable;
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
    failed,
  };
  const declares = (count: number) => {
    const { phrase, plural } = judgedPages(sampled, count, total);
    return `${phrase} declare${plural ? '' : 's'}`;
  };
  if (missing > 0) {
    return warn(`${declares(missing)} no meta viewport${note}`, evidence);
  }
  if (fixed > 0) {
    return warn(`${declares(fixed)} a viewport without width=device-width${note}`, evidence);
  }
  if (zoomBlocked > 0) {
    return warn(
      `${declares(zoomBlocked)} a viewport that forbids zooming (user-scalable=no or maximum-scale below 1)${note}`,
      evidence,
    );
  }
  return pass(`${everyJudgedPage(sampled, total)} declares width=device-width${note}`, evidence);
});
