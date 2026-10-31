import { contentType, type Fetcher } from '../../http/types.js';
import {
  feedRejection,
  isProductFeed,
  parseFeed,
  robotsFeedHints,
  type ParsedFeed,
} from '../../parsers/feed.js';
import { parseLlmsTxt } from '../../parsers/llms-txt.js';
import type { Target } from '../../target/types.js';
import { storeApiUrl } from '../shared.js';
import { type CheckOutcome, defineCheck, fail, pass, skip, warn } from '../types.js';

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

type FeedSource = 'link' | 'llms.txt' | 'robots.txt' | 'sitemap';

interface FeedCandidate {
  url: string;
  source: FeedSource;
}

interface TriedCandidate extends FeedCandidate {
  status: number;
  format?: string;
  reason: string;
}

const FEED_LINK_TYPES = new Set([
  'application/rss+xml',
  'application/atom+xml',
  'text/xml',
  'application/xml',
  'application/json',
]);
const SYNDICATION_TYPES = new Set(['application/rss+xml', 'application/atom+xml']);
const FEED_LINK_HINT = /product|feed|merchant|google|shopping/i;
const LLMS_FEED_HINT = /feed|products\.(?:xml|csv|json)|merchant|google-shopping/i;
const FEED_URL_HINT = /feed/i;
/** Candidates fetched before giving up; the first qualifying one wins. */
const MAX_FEED_FETCHES = 2;
const SAMPLE_ITEMS = 3;
const SAMPLE_KEYS = 8;
const SAMPLE_VALUE_LENGTH = 80;

function resolveHttpUrl(href: string, base: string): string | null {
  try {
    const url = new URL(href, base);
    return url.protocol === 'http:' || url.protocol === 'https:' ? url.href : null;
  } catch {
    return null;
  }
}

function mediaType(type: string | undefined): string {
  return (type ?? '').split(';')[0]?.trim().toLowerCase() ?? '';
}

/**
 * Where a feed may be announced, in the order an agent would look: rel=alternate link
 * tags on the home page, llms.txt links, robots.txt Sitemap and comment lines, then the
 * sitemap itself. De-duplicated by URL.
 */
async function feedCandidates(target: Target, fetcher: Fetcher): Promise<FeedCandidate[]> {
  const candidates: FeedCandidate[] = [];
  const seen = new Set<string>();
  const add = (href: string, source: FeedSource): void => {
    const url = resolveHttpUrl(href, target.origin);
    if (url && !seen.has(url)) {
      seen.add(url);
      candidates.push({ url, source });
    }
  };

  const alternates = target.homeDoc
    .links()
    .filter(
      (link) =>
        link.rel.split(/\s+/).includes('alternate') && FEED_LINK_TYPES.has(mediaType(link.type)),
    );
  const hinted = alternates.filter((link) =>
    FEED_LINK_HINT.test(`${link.href} ${link.title ?? ''}`),
  );
  if (hinted.length > 0) {
    for (const link of hinted) add(link.href, 'link');
  } else {
    const syndication = alternates.filter((link) => SYNDICATION_TYPES.has(mediaType(link.type)));
    const only = syndication[0];
    if (syndication.length === 1 && only) add(only.href, 'link');
  }

  const llms = await fetcher.fetch(`${target.origin}/llms.txt`);
  if (llms.status === 200 && !/<html|<!doctype/i.test(llms.body.slice(0, 500))) {
    for (const link of parseLlmsTxt(llms.body).links) {
      if (LLMS_FEED_HINT.test(`${link.text} ${link.url}`)) add(link.url, 'llms.txt');
    }
  }

  if (target.robotsResponse.status === 200 && target.robots) {
    for (const hint of robotsFeedHints(target.robotsResponse.body)) add(hint, 'robots.txt');
  }

  for (const url of [...(target.sitemap?.childSitemaps ?? []), ...(target.sitemap?.urls ?? [])]) {
    if (FEED_URL_HINT.test(url)) add(url, 'sitemap');
  }
  return candidates;
}

function sampleItem(item: Record<string, string>): Record<string, string> {
  const sample: Record<string, string> = {};
  for (const [key, value] of Object.entries(item).slice(0, SAMPLE_KEYS)) {
    sample[key] =
      value.length > SAMPLE_VALUE_LENGTH ? `${value.slice(0, SAMPLE_VALUE_LENGTH)}…` : value;
  }
  return sample;
}

export const productFeedDiscoverable = defineCheck('B1.5', async ({ target, fetcher }) => {
  const candidates = await feedCandidates(target, fetcher);
  const tried: TriedCandidate[] = [];
  for (const candidate of candidates.slice(0, MAX_FEED_FETCHES)) {
    const response = await fetcher.fetch(candidate.url);
    if (response.status !== 200) {
      tried.push({ ...candidate, status: response.status, reason: `HTTP ${response.status}` });
      continue;
    }
    const feed: ParsedFeed = parseFeed(response.body, contentType(response));
    if (isProductFeed(feed)) {
      return pass(
        `product feed at ${candidate.url} (${feed.format}, ${feed.items.length} item(s) read)`,
        {
          feed_url: candidate.url,
          source: candidate.source,
          format: feed.format,
          content_type: contentType(response),
          namespace_google: feed.namespaceGoogle,
          items_read: feed.items.length,
          fields: feed.fields.slice(0, 30),
          sample: feed.items.slice(0, SAMPLE_ITEMS).map(sampleItem),
          candidates: candidates.map((entry) => entry.url),
          tried,
        },
      );
    }
    tried.push({ ...candidate, status: 200, format: feed.format, reason: feedRejection(feed) });
  }
  const evidence = { candidates: candidates.map((entry) => entry.url), tried };
  if (candidates.length === 0) {
    return fail(
      'no feed link found in llms.txt, robots.txt, the sitemap or rel=alternate link tags',
      evidence,
    );
  }
  return fail(
    `none of the ${tried.length} candidate(s) tried is a product feed: ${tried
      .map((entry) => `${entry.url} (${entry.reason})`)
      .join('; ')}`,
    evidence,
  );
});

const HOUR_MS = 3_600_000;
const FRESH_HOURS = 24;
const STALE_HOURS = 7 * 24;

function parseDate(value: string | null | undefined): number | null {
  if (!value) return null;
  const ms = Date.parse(value);
  return Number.isFinite(ms) ? ms : null;
}

export const feedFreshness = defineCheck(
  'B1.6',
  async ({ fetcher, outcomes }): Promise<CheckOutcome> => {
    const parent = outcomes.get('B1.5');
    const feedUrl =
      parent?.verdict === 'pass' && typeof parent.evidence.feed_url === 'string'
        ? parent.evidence.feed_url
        : null;
    if (!feedUrl) {
      return skip('dependency_failed', 'no product feed found (B1.5)');
    }
    const response = await fetcher.fetch(feedUrl);
    // The server's own clock when it answered, so a recorded response ages the same way
    // every time it is replayed; the scanner's clock otherwise.
    const now = parseDate(response.headers.date) ?? Date.now();
    const lastModified = response.headers['last-modified'] ?? null;
    const feed = parseFeed(response.body, contentType(response));
    const inFeed = feed.lastModifiedInFeed ?? null;
    const evidence: Record<string, unknown> = {
      feed_url: feedUrl,
      status: response.status,
      last_modified: lastModified,
      in_feed: inFeed,
      age_hours: null,
      basis: null,
      scan_time: new Date(now).toISOString(),
    };
    if (response.status !== 200) {
      return fail(`feed returned HTTP ${response.status}`, evidence);
    }
    const stamps = [
      { basis: 'last-modified', at: parseDate(lastModified) },
      { basis: 'in-feed', at: parseDate(inFeed) },
    ].filter((stamp): stamp is { basis: string; at: number } => stamp.at !== null);
    const freshest = stamps.sort((a, b) => b.at - a.at)[0];
    if (!freshest) {
      const unparsed = [lastModified, inFeed].filter((value) => value !== null);
      return fail(
        unparsed.length > 0
          ? `feed timestamp could not be parsed: ${unparsed.join(', ')}`
          : 'feed has no Last-Modified header and no timestamp inside the feed',
        evidence,
      );
    }
    const ageHours = Math.max(0, now - freshest.at) / HOUR_MS;
    const rounded = Math.round(ageHours * 10) / 10;
    evidence.age_hours = rounded;
    evidence.basis = freshest.basis;
    const age = `${rounded} h old (${freshest.basis})`;
    if (ageHours <= FRESH_HOURS) return pass(`feed is ${age}`, evidence);
    if (ageHours <= STALE_HOURS) return warn(`feed is ${age}, older than a day`, evidence);
    return fail(`feed is ${age}, older than a week`, evidence);
  },
);
