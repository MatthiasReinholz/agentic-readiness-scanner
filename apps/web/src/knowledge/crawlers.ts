/**
 * The crawler registry as reader-facing Markdown: the section "Crawlers this check reads" on
 * the access-check articles and the body of /knowledge-base/crawlers. Everything comes from
 * the catalog's registry, so a crawler added there appears here without an edit. The HTML
 * pages render this Markdown with the knowledge base's own renderer.
 */
import {
  AGENT_IDENTITY_LABEL,
  catalog,
  CHECK_CRAWLER_SETS,
  CRAWLER_KIND_LABEL,
  CRAWLER_PURPOSE_LABEL,
  CRAWLER_TIER_LABEL,
  crawlerSet,
  ROBOTS_BEHAVIOUR_LABEL,
  type Crawler,
} from '@agentic-readiness/catalog';

export const CRAWLERS_PATH = '/knowledge-base/crawlers';
export const CRAWLERS_TITLE = 'AI crawler and agent registry';
export const CRAWLERS_DESCRIPTION =
  'Every AI crawler, fetcher and browser agent the scanner reads robots.txt for, with its operator, purpose, robots.txt behaviour, verification and documentation.';

const registry = catalog.crawlers;

/** Markdown tables break on a pipe or a line break inside a cell. */
function cell(text: string): string {
  return text.replace(/\|/g, '/').replace(/\s+/g, ' ').trim();
}

function verifyCell(crawler: Crawler): string {
  const ways = [
    crawler.ip_ranges ? `[IP list](${crawler.ip_ranges})` : '',
    crawler.signature_agent ? `signed (${crawler.signature_agent})` : '',
  ].filter(Boolean);
  return ways.join(', ') || '–';
}

const TIER_ORDER = { core: 0, assistant: 1, other: 2 } as const;

/** Core indexes first, then major assistants, then the rest; registry order within a tier. */
function byTier(crawlers: readonly Crawler[]): Crawler[] {
  return [...crawlers].sort(
    (a, b) => (a.tier ? TIER_ORDER[a.tier] : 3) - (b.tier ? TIER_ORDER[b.tier] : 3),
  );
}

function tokenTable(crawlers: readonly Crawler[], withTier: boolean): string {
  const head = withTier
    ? '| Token | Operator | Tier | robots.txt | Feeds | Verify | Checked |\n| --- | --- | --- | --- | --- | --- | --- |'
    : '| Token | Operator | robots.txt | Feeds | Verify | Checked |\n| --- | --- | --- | --- | --- | --- |';
  const rows = (withTier ? byTier(crawlers) : crawlers).map((crawler) =>
    [
      `[${crawler.token}](${crawler.docs})`,
      cell(crawler.operator),
      ...(withTier ? [crawler.tier ? CRAWLER_TIER_LABEL[crawler.tier] : '–'] : []),
      ROBOTS_BEHAVIOUR_LABEL[crawler.robots],
      cell(crawler.feeds),
      verifyCell(crawler),
      crawler.verified,
    ].join(' | '),
  );
  return [head, ...rows.map((row) => `| ${row} |`)].join('\n');
}

function legacyTable(): string {
  const rows = registry.legacy.map(
    (legacy) =>
      `| [${legacy.token}](${legacy.docs}) | ${cell(legacy.operator)} | ${legacy.replaced_by.join(', ') || 'none: no crawler'} | ${cell(legacy.note)} |`,
  );
  return [
    '| Outdated name | Operator | Current tokens | Note |',
    '| --- | --- | --- | --- |',
    ...rows,
  ].join('\n');
}

function agentTable(): string {
  const rows = registry.agents.map(
    (agent) =>
      `| [${cell(agent.name)}](${agent.docs}) | ${cell(agent.operator)} | ${AGENT_IDENTITY_LABEL[agent.identifies_by]} | ${cell(agent.note)} |`,
  );
  return [
    '| Assistant | Operator | Identifies by | Note |',
    '| --- | --- | --- | --- |',
    ...rows,
  ].join('\n');
}

function botManagerTable(): string {
  const rows = registry.bot_managers.map(
    (manager) =>
      `| [${cell(manager.name)}](${manager.docs}) | ${cell(manager.ai_setting)} | ${cell(manager.note)} |`,
  );
  return ['| Vendor | Where the AI rules are set | Note |', '| --- | --- | --- |', ...rows].join(
    '\n',
  );
}

/** The section shown under an access-check article, or '' for every other check. */
export function crawlerSectionMarkdown(checkId: string): string {
  const set = CHECK_CRAWLER_SETS[checkId];
  if (set === undefined) return '';
  const intro =
    "From the scanner's [crawler registry](/knowledge-base/crawlers). Every entry links to the operator's own documentation and shows the day it was last checked.";
  let table: string;
  if (set === 'legacy') table = legacyTable();
  else if (set === 'bot_managers') table = botManagerTable();
  else table = tokenTable(crawlerSet(registry, set), set !== 'training');
  return `## Crawlers this check reads\n\n${intro}\n\n${table}\n`;
}

/** The body of /knowledge-base/crawlers, without the title. */
export function crawlerRegistryMarkdown(): string {
  const kinds = Object.values(CRAWLER_KIND_LABEL).join(', ');
  const purposes = Object.values(CRAWLER_PURPOSE_LABEL).join(', ');
  return `## In short

The scanner evaluates robots.txt for ${registry.tokens.length} product tokens that AI companies document for their crawlers, fetchers and browser agents. Each entry says what the token is for, what its operator says about robots.txt, how a site can verify the traffic and when the entry was last checked against the operator's documentation. Names that appear only in third-party block lists are not treated as crawlers.

## How to read the registry

- **Kind:** ${kinds}. A robots.txt token only, such as Google-Extended, makes no requests of its own; it governs what another crawler fetched.
- **Purposes:** ${purposes}.
- **Tier:** a core index (Google and Bing), a major assistant's own crawler or fetcher, or a regional or developer service. Blocking a core index or two major assistants fails the [search crawler check](/knowledge-base/search-and-assistant-crawlers-allowed); regional and developer services are reported without changing the verdict.
- **robots.txt:** whether the operator says the client obeys robots.txt, may ignore it because a person asked, or says nothing.
- **Verify:** the operator's published IP list or the Signature-Agent of its signed requests, to compare with your logs.

## Training

These tokens decide whether content may train AI models. The [training-crawler check](/knowledge-base/ai-training-crawler-policy) asks that robots.txt states a decision for them, in either direction.

${tokenTable(crawlerSet(registry, 'training'), false)}

## Search indexes behind AI answers

${tokenTable(crawlerSet(registry, 'index'), true)}

## Fetchers and agents acting for a person

The [user-triggered fetcher check](/knowledge-base/user-triggered-fetchers-allowed) reads these.

${tokenTable(crawlerSet(registry, 'fetchers'), true)}

## Outdated names

robots.txt files still name these tokens, but their operators document them no longer, or never did. A group for one reaches none of the operator's current crawlers. The [crawler names check](/knowledge-base/robots-txt-crawler-names-current) finds them.

${legacyTable()}

## Assistants without a robots.txt token

These assistants reach sites without a name robots.txt can address. The guide [How AI crawlers, assistants and agents reach your site](/knowledge-base/guides/ai-crawlers-and-agents) explains what that means for a store.

${agentTable()}

## Bot managers

A CDN or bot manager can refuse the clients above by user agent, whatever robots.txt says. The [edge rules check](/knowledge-base/edge-ai-crawler-rules) recognises these vendors and points to their settings.

${botManagerTable()}
`;
}
