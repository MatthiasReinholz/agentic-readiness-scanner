/**
 * The crawler lists the access checks evaluate, read from the catalog's crawler registry
 * (packages/catalog/data/crawlers.json, decision 0020). Nothing here names a crawler: a
 * token is added, renamed or reclassified in the registry, and every check, report, fix
 * and knowledge-base page follows.
 *
 * The grouping is the point. Blocking a training crawler is a licensing decision and never
 * loses points; blocking the crawler that builds an assistant's index removes the site from
 * that assistant's answers; fetchers act because a person asked, and several of them say
 * robots.txt may not apply.
 */
import {
  catalog,
  crawlerSet,
  type BotManager,
  type Crawler,
  type CrawlerTier,
  type LegacyToken,
  type RobotsBehaviour,
} from '@agentic-readiness/catalog';

const registry = catalog.crawlers;

/** The shared robots.txt token for AI training preferences (draft-kelley-aipref-training-preference-signal). */
export const SHARED_TRAINING_TOKEN = '__usage_ai-training';

/** Every token whose content may train models: what A2.1 asks a decision about. */
export const TRAINING_CRAWLERS: readonly string[] = crawlerSet(registry, 'training').map(
  (crawler) => crawler.token,
);

export interface SearchCrawler {
  token: string;
  operator: string;
  /** A crawler fetches pages; a token (Google-Extended) only governs what another crawler fetched. */
  kind: 'crawler' | 'token';
  /** Which assistants or surfaces lose the site when this crawler is blocked. */
  feeds: string;
  tier: CrawlerTier;
  /** Blocking a core crawler fails A2.2 on its own. */
  core: boolean;
}

/** Crawlers and tokens behind the search indexes AI answers draw on (A2.2). */
export const SEARCH_CRAWLERS: readonly SearchCrawler[] = crawlerSet(registry, 'index').map(
  (crawler) => ({
    token: crawler.token,
    operator: crawler.operator,
    kind: crawler.kind === 'token' ? 'token' : 'crawler',
    feeds: crawler.feeds,
    tier: tierOf(crawler),
    core: crawler.tier === 'core',
  }),
);

/**
 * The core and major-assistant crawlers that fetch pages for an index: what the policy-page
 * and text-and-data-mining checks ask about. Control tokens (Google-Extended) and regional
 * or developer services are left out, so a training reservation or a regional block never
 * makes a policy page count as unreadable.
 */
export const MAJOR_INDEX_CRAWLERS: readonly SearchCrawler[] = SEARCH_CRAWLERS.filter(
  (crawler) => crawler.kind === 'crawler' && crawler.tier !== 'other',
);

export interface UserFetcher {
  token: string;
  operator: string;
  feeds: string;
  tier: CrawlerTier;
  /** What the operator documents about robots.txt for this fetcher. */
  robots: RobotsBehaviour;
}

/** Fetchers and browser agents that act when a person or an agent asks (A2.5). */
export const USER_FETCHER_DETAILS: readonly UserFetcher[] = crawlerSet(registry, 'fetchers').map(
  (crawler) => ({
    token: crawler.token,
    operator: crawler.operator,
    feeds: crawler.feeds,
    tier: tierOf(crawler),
    robots: crawler.robots,
  }),
);

/** The fetcher tokens alone, for robots.txt templates and older callers. */
export const USER_FETCHERS: readonly string[] = USER_FETCHER_DETAILS.map(
  (fetcher) => fetcher.token,
);

/** Lower-cased tokens whose loss removes the site from AI answers: index crawlers and fetchers. */
export const ANSWER_AGENTS: ReadonlySet<string> = new Set(
  crawlerSet(registry, 'answers').map((crawler) => crawler.token.toLowerCase()),
);

/** Tokens robots.txt files still name although their operators document them no longer (A2.13). */
export const LEGACY_TOKENS: readonly LegacyToken[] = registry.legacy;

/** CDNs and bot managers with the place their AI crawler rules are set (A2.14). */
export const BOT_MANAGERS: readonly BotManager[] = registry.bot_managers;

/** The operator of a current token, for messages that group by company. */
export function operatorOf(token: string): string | undefined {
  const key = token.toLowerCase();
  return registry.tokens.find((crawler) => crawler.token.toLowerCase() === key)?.operator;
}

/** The registry guarantees a tier for every crawler outside the training-only set. */
function tierOf(crawler: Crawler): CrawlerTier {
  if (!crawler.tier) throw new Error(`crawler registry: ${crawler.token} has no tier`);
  return crawler.tier;
}
