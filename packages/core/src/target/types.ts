import type { Platform, Profile, SampledPages } from '@agentic-readiness/catalog';

import type { FetchedResponse } from '../http/types.js';
import type { HtmlDocument } from '../parsers/html.js';
import type { RobotsTxt } from '../parsers/robots.js';

export interface SitemapSummary {
  /** The sitemap URL that answered first. */
  url: string;
  kind: 'index' | 'urlset';
  childSitemaps: string[];
  /** Child sitemaps that were actually fetched within budget. */
  fetchedSitemaps: string[];
  urls: string[];
  productUrls: string[];
}

/**
 * The resolved store: everything checks share. Built once by resolveTarget and passed
 * read-only to every check. Page bodies are not stored here; the fetcher caches them.
 */
export interface Target {
  inputUrl: string;
  origin: string;
  hostname: string;
  platform: Platform;
  profile: Profile;
  home: FetchedResponse;
  homeDoc: HtmlDocument;
  robotsResponse: FetchedResponse;
  robots: RobotsTxt | null;
  sitemap: SitemapSummary | null;
  sampled: SampledPages;
  warnings: string[];
}
