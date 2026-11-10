/**
 * Named sets over the crawler registry, and the placeholders that write them into check
 * methods, fixes, articles and guides at build time. The engine and the text read the same
 * sets, so a crawler added to `data/crawlers.json` reaches the checks, the reports, the fix
 * snippets and the knowledge base in one change.
 *
 * A set is a base, optionally narrowed by filters joined with dots:
 *   training             every token whose content may train models (A2.1)
 *   index                crawlers and tokens behind a search index (A2.2)
 *   fetchers             fetchers and agents acting for a person (A2.5)
 *   answers              index and fetchers together: everything that feeds AI answers
 * Filters: a tier (core, assistant, other) or a robots behaviour (honours, may-ignore,
 * not-stated). `index.core` is Googlebot and Bingbot; `fetchers.may-ignore` the fetchers
 * whose operators say robots.txt may not apply.
 *
 * Placeholders, in any text the catalog build reads:
 *   {{crawlers:<set>}}   a list for prose: "GPTBot, ClaudeBot and CCBot"
 *   {{robots:<set>}}     one "User-agent: <token>" line per token, for robots.txt snippets
 *   {{count:<set>}}      how many tokens the set holds
 */
import type {
  AgentIdentity,
  Crawler,
  CrawlerKind,
  CrawlerPurpose,
  CrawlerRegistry,
  CrawlerTier,
  RobotsBehaviour,
} from './schema.js';

export const CRAWLER_SET_BASES = ['training', 'index', 'fetchers', 'answers'] as const;
export type CrawlerSetBase = (typeof CRAWLER_SET_BASES)[number];

const TIERS = new Set(['core', 'assistant', 'other']);
const BEHAVIOURS = new Set(['honours', 'may-ignore', 'not-stated']);

function inBase(crawler: Crawler, base: CrawlerSetBase): boolean {
  switch (base) {
    case 'training':
      return crawler.purposes.includes('training');
    case 'index':
      return (
        (crawler.kind === 'crawler' || crawler.kind === 'token') &&
        crawler.purposes.includes('search')
      );
    case 'fetchers':
      return crawler.kind === 'fetcher' || crawler.kind === 'agent';
    case 'answers':
      return inBase(crawler, 'index') || inBase(crawler, 'fetchers');
  }
}

export class CrawlerSetError extends Error {
  constructor(name: string, reason: string) {
    super(`unknown crawler set "${name}": ${reason}`);
    this.name = 'CrawlerSetError';
  }
}

/** The registry entries in a named set, in registry order. Throws on an unknown name. */
export function crawlerSet(registry: CrawlerRegistry, name: string): Crawler[] {
  const [base, ...filters] = name.split('.');
  if (!CRAWLER_SET_BASES.includes(base as CrawlerSetBase))
    throw new CrawlerSetError(name, `the base must be one of ${CRAWLER_SET_BASES.join(', ')}`);
  for (const filter of filters)
    if (!TIERS.has(filter) && !BEHAVIOURS.has(filter))
      throw new CrawlerSetError(name, `"${filter}" is neither a tier nor a robots behaviour`);
  return registry.tokens.filter(
    (crawler) =>
      inBase(crawler, base as CrawlerSetBase) &&
      filters.every((filter) =>
        TIERS.has(filter) ? crawler.tier === filter : crawler.robots === filter,
      ),
  );
}

/** "A", "A and B", "A, B and C". */
export function listForProse(items: readonly string[]): string {
  if (items.length <= 1) return items.join('');
  return `${items.slice(0, -1).join(', ')} and ${items.at(-1) ?? ''}`;
}

const PLACEHOLDER = /\{\{(crawlers|robots|count):([a-z.-]+)\}\}/g;
/**
 * A crawler placeholder the strict pattern did not take (stray spaces, capitals), so a typo
 * fails the build instead of shipping. Other double braces, such as Liquid in a Shopify
 * snippet, are left alone.
 */
const PLACEHOLDER_LIKE = /\{\{\s*(?:crawlers|robots|count)\s*:[^{}]*\}\}/gi;

/**
 * Replaces the crawler placeholders in a text. Throws a CrawlerSetError on an unknown set,
 * an unknown placeholder kind or an empty set, so a typo never reaches a published page.
 */
export function expandCrawlerPlaceholders(text: string, registry: CrawlerRegistry): string {
  const expanded = text.replace(PLACEHOLDER, (_match, kind: string, name: string) => {
    const tokens = crawlerSet(registry, name).map((crawler) => crawler.token);
    if (tokens.length === 0) throw new CrawlerSetError(name, 'the set is empty');
    if (kind === 'count') return String(tokens.length);
    if (kind === 'robots') return tokens.map((token) => `User-agent: ${token}`).join('\n');
    return listForProse(tokens);
  });
  const leftover = expanded.match(PLACEHOLDER_LIKE);
  if (leftover) throw new CrawlerSetError(leftover[0], 'not a crawler placeholder');
  return expanded;
}

/**
 * The documented fallbacks, lower-cased: when robots.txt names no group for the key, the
 * operator says its crawler follows the group of the value (Applebot follows Googlebot).
 */
export function crawlerFallbacks(registry: CrawlerRegistry): Record<string, string> {
  return Object.fromEntries(
    registry.tokens
      .filter((crawler) => crawler.follows !== undefined)
      .map((crawler) => [crawler.token.toLowerCase(), (crawler.follows ?? '').toLowerCase()]),
  );
}

/** Reader-facing names for the registry's fields, shared by the docs, the pages and reports. */
export const CRAWLER_KIND_LABEL: Record<CrawlerKind, string> = {
  crawler: 'crawler',
  fetcher: 'fetcher on request',
  agent: 'browser agent',
  token: 'robots.txt token only',
};

export const CRAWLER_PURPOSE_LABEL: Record<CrawlerPurpose, string> = {
  training: 'AI training',
  search: 'search index',
  answers: 'live answers',
  actions: 'tasks for a person',
};

export const CRAWLER_TIER_LABEL: Record<CrawlerTier, string> = {
  core: 'core index',
  assistant: 'major assistant',
  other: 'regional or developer service',
};

export const ROBOTS_BEHAVIOUR_LABEL: Record<RobotsBehaviour, string> = {
  honours: 'obeys robots.txt',
  'may-ignore': 'may ignore robots.txt',
  'not-stated': 'not stated',
};

export const AGENT_IDENTITY_LABEL: Record<AgentIdentity['identifies_by'], string> = {
  signature: 'signed requests (Web Bot Auth)',
  'own-browser': "the person's own browser",
  none: 'nothing documented',
};

/**
 * Which part of the registry each access check reads, for pages and docs that show it next
 * to the check. The checks themselves read the same sets through core's crawlers module.
 */
export const CHECK_CRAWLER_SETS: Readonly<
  Record<string, CrawlerSetBase | 'legacy' | 'bot_managers'>
> = {
  'A2.1': 'training',
  'A2.2': 'index',
  'A2.5': 'fetchers',
  'A2.13': 'legacy',
  'A2.14': 'bot_managers',
};
