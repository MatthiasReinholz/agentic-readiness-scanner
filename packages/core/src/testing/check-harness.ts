/**
 * Unit-test harness for checks: a Fetcher that answers from an in-memory map, a Target
 * builder and a one-check runner, so a test can exercise one verdict branch without a
 * recorded store. Web-standard only; it lives on the testing entry point because that is
 * where test code looks, next to the fixture loader.
 */
import {
  getCheck,
  getProfile,
  type Platform,
  type PolicyKind,
  type SampledPages,
} from '@agentic-readiness/catalog';

import type { Check, CheckOutcome } from '../checks/types.js';
import {
  FixtureFetcher,
  type FixtureFetcherOptions,
  type FixtureResponse,
} from '../http/fixture-fetcher.js';
import type { FetchedResponse, Fetcher } from '../http/types.js';
import { HtmlDocument } from '../parsers/html.js';
import { parseRobotsTxt } from '../parsers/robots.js';
import type { SitemapSummary, Target } from '../target/types.js';

/** A bare string is a 200 response with that body; a list holds conditional answers (see FixtureResponse.when). */
export type MapResponse = string | FixtureResponse | FixtureResponse[];

/** A Fetcher answering from URL to response. URLs not in the map answer 404. */
export function mapFetcher(
  record: Record<string, MapResponse>,
  options: FixtureFetcherOptions = {},
): FixtureFetcher {
  const responses: Record<string, FixtureResponse | FixtureResponse[]> = {};
  for (const [url, response] of Object.entries(record)) {
    responses[url] = typeof response === 'string' ? { status: 200, body: response } : response;
  }
  return new FixtureFetcher(responses, options);
}

/** The response object a Fetcher would return for a recorded answer. */
export function responseOf(url: string, recorded: FixtureResponse): FetchedResponse {
  const body = recorded.body ?? '';
  const headers: Record<string, string> = {};
  for (const [name, value] of Object.entries(recorded.headers ?? {})) {
    headers[name.toLowerCase()] = value;
  }
  return {
    url,
    finalUrl: url,
    status: recorded.status,
    headers,
    body,
    bytes: new TextEncoder().encode(body).byteLength,
    truncated: false,
    redirects: 0,
    durationMs: 1,
    fromCache: false,
    ...(recorded.status === 0 ? { error: 'network error' } : {}),
  };
}

export interface TargetOptions {
  /** Defaults to https://shop.example. */
  origin?: string;
  /** Defaults to woocommerce. */
  platform?: Platform;
  /** Profile id; defaults to the profile the resolver would pick for the platform. */
  profile?: string;
  homeHtml?: string;
  /** A string is a 200 text body; null or omitted is a 404; a response is used as is. */
  robots?: string | FixtureResponse | null;
  sitemap?: SitemapSummary | null;
  /** Sampled product page URLs; the fetcher must answer them. */
  products?: string[];
  listing?: string;
  policies?: Partial<Record<PolicyKind, string>>;
}

const EMPTY_HOME = '<!doctype html><html><head><title>Shop</title></head><body></body></html>';

function defaultProfile(platform: Platform): string {
  if (platform === 'woocommerce') return 'woocommerce-store';
  if (platform === 'shopify') return 'other-store';
  return 'content-site';
}

/** A resolved Target without resolving anything: every field is what the options say. */
export function targetFor(options: TargetOptions = {}): Target {
  const origin = options.origin ?? 'https://shop.example';
  const platform = options.platform ?? 'woocommerce';
  const profileId = options.profile ?? defaultProfile(platform);
  const profile = getProfile(profileId);
  if (!profile) throw new Error(`Unknown profile ${profileId}`);
  const home = responseOf(`${origin}/`, {
    status: 200,
    headers: { 'content-type': 'text/html' },
    body: options.homeHtml ?? EMPTY_HOME,
  });
  const robotsRecorded: FixtureResponse =
    options.robots === undefined || options.robots === null
      ? { status: 404, body: '' }
      : typeof options.robots === 'string'
        ? { status: 200, headers: { 'content-type': 'text/plain' }, body: options.robots }
        : options.robots;
  const robotsResponse = responseOf(`${origin}/robots.txt`, robotsRecorded);
  // Same rule as the resolver: only a 200 that is not HTML is parsed.
  const robots =
    robotsResponse.status === 200 && !/<html|<!doctype/i.test(robotsResponse.body.slice(0, 500))
      ? parseRobotsTxt(robotsResponse.body)
      : null;
  const sampled: SampledPages = {
    home: home.finalUrl,
    ...(options.listing ? { listing: options.listing } : {}),
    products: options.products ?? [],
    policies: options.policies ?? {},
  };
  return {
    inputUrl: origin,
    origin,
    hostname: new URL(origin).hostname,
    platform,
    profile,
    home,
    homeDoc: new HtmlDocument(home.body),
    robotsResponse,
    robots,
    sitemap: options.sitemap ?? null,
    sampled,
    warnings: [],
  };
}

/** Runs one check with its catalog definition and the given earlier outcomes. */
export function runCheck(
  check: Check,
  target: Target,
  fetcher: Fetcher,
  outcomes: ReadonlyMap<string, CheckOutcome> = new Map(),
): Promise<CheckOutcome> {
  const definition = getCheck(check.id);
  if (!definition) throw new Error(`Check ${check.id} is not in the catalog`);
  return check.run({ target, fetcher, definition, outcomes });
}

/** Narrows a possibly missing value for an assertion, throwing instead of asserting non-null. */
export function defined<T>(value: T | null | undefined, what = 'value'): T {
  if (value === null || value === undefined) throw new Error(`expected ${what} to be defined`);
  return value;
}
