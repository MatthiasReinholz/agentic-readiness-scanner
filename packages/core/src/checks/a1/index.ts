import { contentType } from '../../http/types.js';
import { attribute, elementText, HtmlDocument } from '../../parsers/html.js';
import { parseLinkHeader, type LinkValue } from '../../parsers/link-header.js';
import { isWellFormedLlmsTxt, parseLlmsTxt } from '../../parsers/llms-txt.js';
import { isW3cDatetime, looksLikeProductUrl } from '../../parsers/sitemap.js';
import { LASTMOD_SAMPLE_LIMIT } from '../../target/types.js';
import { defineCheck, fail, pass, skip, warn } from '../types.js';

export const robotsTxtExists = defineCheck('A1.1', ({ target }) => {
  const response = target.robotsResponse;
  const evidence = {
    url: response.finalUrl,
    status: response.status,
    content_type: contentType(response),
    groups: target.robots?.groups.length ?? 0,
    sitemaps: target.robots?.sitemaps ?? [],
  };
  if (response.status === 200 && target.robots) {
    return pass(`robots.txt parsed with ${target.robots.groups.length} group(s)`, evidence);
  }
  if (response.status === 404) {
    return warn(
      'robots.txt is missing; everything is allowed by default but intent is unstated',
      evidence,
    );
  }
  // RFC 9309 section 2.3.1.3: any other 4xx means "unavailable", and crawlers may then
  // access everything, so it is the same unstated-intent case as a missing file.
  if (response.status >= 400 && response.status < 500) {
    return warn(
      `robots.txt returned HTTP ${response.status}; crawlers treat that as "allow all" but intent is unstated`,
      evidence,
    );
  }
  if (response.status === 0) {
    return fail(`robots.txt could not be fetched: ${response.error ?? 'no response'}`, evidence);
  }
  if (response.status === 200) {
    return fail(
      'robots.txt returned HTML instead of a robots file (challenge page or soft 404)',
      evidence,
    );
  }
  return fail(`robots.txt returned HTTP ${response.status}`, evidence);
});

export const sitemapReachable = defineCheck('A1.2', ({ target }) => {
  const sitemap = target.sitemap;
  if (!sitemap) {
    return fail(
      'no sitemap found via robots.txt, /sitemap.xml, /sitemap_index.xml or /wp-sitemap.xml',
      { declared_in_robots: target.robots?.sitemaps ?? [] },
    );
  }
  const evidence = {
    url: sitemap.url,
    kind: sitemap.kind,
    child_sitemaps: sitemap.childSitemaps.length,
    urls: sitemap.urls.length,
    declared_in_robots: target.robots?.sitemaps.includes(sitemap.url) ?? false,
  };
  if (sitemap.urls.length === 0 && sitemap.childSitemaps.length === 0) {
    return warn('sitemap is reachable but lists no URLs', evidence);
  }
  return pass(`sitemap ${sitemap.kind} at ${sitemap.url}`, evidence);
});

export const productUrlsInSitemap = defineCheck('A1.3', ({ target }) => {
  const sitemap = target.sitemap;
  const productSitemaps = sitemap?.childSitemaps.filter((url) => /product/i.test(url)) ?? [];
  const evidence = {
    product_sitemaps: productSitemaps,
    product_urls: sitemap?.productUrls.length ?? 0,
    sample: sitemap?.productUrls.slice(0, 5) ?? [],
  };
  if ((sitemap?.productUrls.length ?? 0) > 0) {
    return pass(`${sitemap?.productUrls.length ?? 0} product URL(s) in sitemap`, evidence);
  }
  if (productSitemaps.length > 0) {
    return warn(
      'a product sitemap is declared but no product URLs were read within budget',
      evidence,
    );
  }
  return fail('no product URLs or product sitemap found', evidence);
});

export const llmsTxtPresent = defineCheck('A1.5', async ({ target, fetcher }) => {
  const url = `${target.origin}/llms.txt`;
  const response = await fetcher.fetch(url);
  const evidence: Record<string, unknown> = {
    url,
    status: response.status,
    content_type: contentType(response),
  };
  // Optional file, no documented consumer among the major assistants: absence is not scored.
  if (response.status === 404 || response.status === 410) {
    return skip('not_applicable', 'no llms.txt (optional; its absence is not scored)', evidence);
  }
  if (response.status !== 200) {
    return fail(`llms.txt returned HTTP ${response.status}`, evidence);
  }
  if (/<html|<!doctype/i.test(response.body.slice(0, 500))) {
    return fail('llms.txt returned HTML (soft 404 or challenge page)', evidence);
  }
  const parsed = parseLlmsTxt(response.body);
  evidence.title = parsed.title;
  evidence.sections = parsed.sections;
  evidence.links = parsed.links.length;
  if (parsed.title === null) {
    return fail(
      'llms.txt does not start with an H1, the one element the proposal requires',
      evidence,
    );
  }
  if (!isWellFormedLlmsTxt(parsed)) {
    return warn('llms.txt has an H1 but no links', evidence);
  }
  return pass(`llms.txt "${parsed.title}" with ${parsed.links.length} link(s)`, evidence);
});

const CATALOG_LINK_PATTERN =
  /feed|wc\/store|products?\.(xml|json|csv)|sitemap.*product|product.*sitemap|\/shop\/?$|\/products?\/?$|catalog/i;

export const llmsTxtLinksToCatalog = defineCheck('A1.6', async ({ target, fetcher }) => {
  const response = await fetcher.fetch(`${target.origin}/llms.txt`);
  const parsed = parseLlmsTxt(response.body);
  const catalogLinks = parsed.links.filter((link) =>
    CATALOG_LINK_PATTERN.test(`${link.text} ${link.url}`),
  );
  const evidence = { catalog_links: catalogLinks.map((link) => link.url) };
  if (catalogLinks.length > 0) {
    return pass(`${catalogLinks.length} catalog link(s) in llms.txt`, evidence);
  }
  return fail('llms.txt has no link to a feed, Store API or product index', evidence);
});

/** Relations an agent can act on whatever the media type. */
const AGENT_RELATIONS = new Set(['llms-txt', 'api-catalog', 'service-desc', 'describedby', 'ucp']);
/** Relations that count only with the media type that makes the target machine-readable. */
const TYPED_AGENT_RELATIONS = new Map([
  ['license', 'application/rsl+xml'],
  ['alternate', 'text/markdown'],
]);

/** True when the link carries one of the relations the catalog method names for A1.4. */
export function isAgentUsableLink(link: LinkValue): boolean {
  return link.rel.some((rel) => {
    if (AGENT_RELATIONS.has(rel)) return true;
    const wantedType = TYPED_AGENT_RELATIONS.get(rel);
    return wantedType !== undefined && link.type === wantedType;
  });
}

function resolveHref(href: string, base: string): string {
  try {
    return new URL(href, base).href;
  } catch {
    return href;
  }
}

interface FoundLink {
  page: string;
  href: string;
  rel: string[];
  type: string | null;
  usable: boolean;
}

export const linkResponseHeaders = defineCheck('A1.4', async ({ target, fetcher }) => {
  const pages: { url: string; header: string | null }[] = [
    { url: target.home.finalUrl, header: target.home.headers.link ?? null },
  ];
  const product = target.sampled.products[0];
  if (product !== undefined) {
    const response = await fetcher.fetch(product);
    pages.push({ url: product, header: response.headers.link ?? null });
  }
  const links: FoundLink[] = [];
  for (const page of pages) {
    for (const link of parseLinkHeader(page.header)) {
      links.push({
        page: page.url,
        href: resolveHref(link.href, page.url),
        rel: link.rel,
        type: link.type ?? null,
        usable: isAgentUsableLink(link),
      });
    }
  }
  const usable = links.filter((link) => link.usable);
  const evidence = { pages: pages.map((page) => page.url), links, usable: usable.length };
  if (usable.length > 0) {
    const relations = [...new Set(usable.flatMap((link) => link.rel))].join(', ');
    return pass(`Link header relation(s) an agent can use: ${relations}`, evidence);
  }
  if (links.length > 0) {
    return fail(
      `${links.length} Link header value(s) but none with a relation an agent can use`,
      evidence,
    );
  }
  return fail('no Link response header on the home page or a sampled product page', evidence);
});

/** Share of entries that must carry a valid lastmod for a pass. */
const LASTMOD_PASS_SHARE = 0.8;

export const sitemapLastmodPlausible = defineCheck('A1.7', ({ target }) => {
  const sitemap = target.sitemap;
  if (!sitemap) {
    return skip('dependency_failed', 'no sitemap to read lastmod from (A1.2)', {});
  }
  // The resolver records lastmod for the first LASTMOD_SAMPLE_LIMIT entries only.
  const read = Math.min(sitemap.urls.length, LASTMOD_SAMPLE_LIMIT);
  const lastmods = sitemap.lastmods ?? [];
  const valid = lastmods.filter(isW3cDatetime);
  const invalid = lastmods.filter((value) => !isW3cDatetime(value));
  const distinct = new Set(valid).size;
  const share = read > 0 ? valid.length / read : 0;
  const evidence = {
    sitemaps_read: [sitemap.url, ...sitemap.fetchedSitemaps],
    entries_read: read,
    with_lastmod: lastmods.length,
    valid_lastmod: valid.length,
    invalid_lastmod: invalid.length,
    distinct_values: distinct,
    share: Number(share.toFixed(2)),
    sample: valid.slice(0, 5),
    invalid_sample: invalid.slice(0, 3),
  };
  if (read === 0) {
    return skip('not_applicable', 'the sitemaps read list no URL entries', evidence);
  }
  if (valid.length === 0) {
    return fail(
      lastmods.length > 0
        ? `${lastmods.length} lastmod value(s) found but none is a valid W3C datetime`
        : `none of the ${read} sitemap entries read carries <lastmod>`,
      evidence,
    );
  }
  if (share < LASTMOD_PASS_SHARE) {
    return warn(
      `${valid.length} of ${read} sitemap entries read carry a valid lastmod (under 80 percent)`,
      evidence,
    );
  }
  // One entry cannot show a request-time stamp; two or more identical values can.
  if (valid.length > 1 && distinct === 1) {
    return warn(
      `every lastmod of the ${valid.length} entries read is ${valid[0] ?? ''}; a value stamped at request time tells agents nothing`,
      evidence,
    );
  }
  return pass(
    `${valid.length} of ${read} sitemap entries read carry a valid lastmod with ${distinct} distinct value(s)`,
    evidence,
  );
});

/** A URL that names a page number: WordPress /page/2/ or a page, p, paged or pg query parameter. */
const PAGINATION_URL = /\/page\/\d+\/?$|[?&](page|p|paged|pg)=\d+/i;
/** Text or class of a control that loads more results without a link a crawler can follow. */
const LOAD_MORE = /load more|show more|mehr laden|infinite|load-more|loadmore/i;
/** Load-more controls kept in evidence. */
const LOAD_MORE_SAMPLE = 5;

/** The anchor URL resolved against the page, without its fragment, or null when off-origin or unparsable. */
function sameOriginUrl(href: string, base: string, origin: string): string | null {
  try {
    const url = new URL(href, base);
    if (url.origin !== origin) return null;
    url.hash = '';
    return url.href;
  } catch {
    return null;
  }
}

export const listingLinksProductsAndPages = defineCheck('A1.8', async ({ target, fetcher }) => {
  const listing = target.sampled.listing;
  if (listing === undefined) {
    return skip('not_applicable', 'no listing page was found on the home page');
  }
  const response = await fetcher.fetch(listing);
  const evidence: Record<string, unknown> = { url: listing, status: response.status };
  if (response.status === 0) {
    return warn(
      `the listing page could not be fetched: ${response.error ?? 'no response'}`,
      evidence,
    );
  }
  if (response.status >= 400) {
    return warn(`the listing page answered HTTP ${response.status}`, evidence);
  }
  const doc = new HtmlDocument(response.body);
  const base = response.finalUrl || listing;
  const self = sameOriginUrl(base, base, target.origin);
  const urls = new Set<string>();
  for (const anchor of doc.anchors()) {
    const url = sameOriginUrl(anchor.href, base, target.origin);
    if (url !== null && url !== self) urls.add(url);
  }
  const paginationLinks = [...urls].filter((url) => PAGINATION_URL.test(url));
  // A page-number URL under /products/ names a page, not a product.
  const productLinks = [...urls].filter(
    (url) => looksLikeProductUrl(url) && !PAGINATION_URL.test(url),
  );
  const relNext = doc.links().some((link) => link.rel.split(/\s+/).includes('next'));
  const loadMore: string[] = [];
  for (const control of doc.controls()) {
    const label = control.text !== '' ? control.text : (control.value ?? '');
    if (LOAD_MORE.test(`${label} ${control.className ?? ''} ${control.id ?? ''}`)) {
      loadMore.push(label !== '' ? label : (control.className ?? control.id ?? control.tag));
    }
  }
  for (const anchor of doc.anchors()) {
    if (LOAD_MORE.test(anchor.text)) loadMore.push(anchor.text);
  }
  for (const element of doc.find('a', 'class', LOAD_MORE)) {
    const text = elementText(element).replace(/\s+/g, ' ').trim();
    if (!LOAD_MORE.test(text))
      loadMore.push(text !== '' ? text : (attribute(element, 'class') ?? 'a'));
  }
  Object.assign(evidence, {
    product_links: productLinks.length,
    pagination_links: paginationLinks.length,
    rel_next: relNext,
    load_more_controls: loadMore.slice(0, LOAD_MORE_SAMPLE),
    product_sample: productLinks.slice(0, 5),
    pagination_sample: paginationLinks.slice(0, 3),
  });
  if (productLinks.length === 0) {
    return warn(
      'no product link is in the server-rendered HTML of the listing page; crawlers that do not run scripts find no products there',
      evidence,
    );
  }
  const paginates = paginationLinks.length > 0 || relNext;
  if (paginates) {
    return pass(
      `${productLinks.length} product link(s) and ${paginationLinks.length} pagination link(s)${relNext ? ' plus rel=next' : ''} on the listing page`,
      evidence,
    );
  }
  if (loadMore.length > 0) {
    return warn(
      `${productLinks.length} product link(s) on the listing page, but more of them load only through a button or infinite scroll, which Google's crawlers do not click or scroll`,
      evidence,
    );
  }
  return pass(
    `${productLinks.length} product link(s) on the listing page and no pagination`,
    evidence,
  );
});
