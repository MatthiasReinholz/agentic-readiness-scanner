import {
  catalog as defaultCatalog,
  forOtherPlatform,
  platformLabel,
  requiredPlatform,
  TechnologyFactSchema,
  type Catalog,
  type CheckResult,
  type Dimension,
  type ScanResult,
  type TechnologyFact,
} from '@agentic-readiness/catalog';

import { dimensionScore, type DimensionScore } from '../scoring.js';

/**
 * One dimension's score as text: "83/100", "incomplete (6% of weighted checks answered)"
 * or "not applicable", the same on every surface.
 */
export function scoreText(result: ScanResult, dimension: 'ingestion' | 'commerce'): string {
  const score: DimensionScore = dimensionScore(result.scores, dimension);
  if (score.state === 'incomplete')
    return `incomplete (${String(score.coverage)}% of weighted checks answered)`;
  if (score.state === 'not_applicable') return 'not applicable';
  return `${String(score.value)}/100`;
}

/**
 * The sentence that explains a capped dimension, or null when no ceiling holds: what the
 * cap is, what the score would be without it, and which checks lift it.
 */
export function ceilingSentence(
  result: ScanResult,
  dimension: 'ingestion' | 'commerce',
): string | null {
  const ceiling = result.scores.ceilings?.[dimension];
  if (!ceiling || dimensionScore(result.scores, dimension).state !== 'scored') return null;
  const lift =
    ceiling.lifted_by.length > 0
      ? ` Lifted by ${ceiling.lifted_by
          .map((id) => {
            const found = result.results.find((item) => item.id === id);
            return found ? `${id} ${found.title}` : id;
          })
          .join(' or ')}.`
      : '';
  return ceiling.raw > ceiling.value
    ? `Capped at ${String(ceiling.value)} while ${ceiling.reason}. Without the cap it would be ${String(ceiling.raw)}.${lift}`
    : `Cannot exceed ${String(ceiling.value)} while ${ceiling.reason}.${lift}`;
}

/**
 * The site a report is about, linked from the report's heading: a plain followed link
 * with the site's own address as its text, on the page that describes that site. Only
 * http and https addresses are linked; anything else stays text.
 */
export function siteHeadingLink(url: string, labelHtml: string): string {
  if (!/^https?:\/\//i.test(url)) return labelHtml;
  return `<a class="hero-title-link" href="${escapeHtml(url)}">${labelHtml}</a>`;
}

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function definitionOf(id: string, catalog: Catalog) {
  return catalog.checks.find((check) => check.id === id);
}

/**
 * The results a rendered report lists: every check except those bound to a platform the
 * target does not run (a Shopify check on a WooCommerce store). Those never ran and say
 * nothing about this site; the JSON result keeps them, as its contract lists every check.
 */
export function shownResults(result: ScanResult, catalog: Catalog = defaultCatalog): CheckResult[] {
  return result.results.filter((item) => {
    const definition = definitionOf(item.id, catalog);
    return !definition || !forOtherPlatform(definition, result.target.platform);
  });
}

/**
 * The platform-specific checks a report lists for this target: the ones bound to the
 * recognised platform (or to the platform it runs on). Empty when no platform was
 * recognised or the catalog has no check for it.
 */
export function platformResults(
  result: ScanResult,
  catalog: Catalog = defaultCatalog,
): CheckResult[] {
  return shownResults(result, catalog).filter((item) => {
    const definition = definitionOf(item.id, catalog);
    return definition !== undefined && requiredPlatform(definition) !== null;
  });
}

/** A technology fact with the check that established it, for linking. */
export interface ShownTechnologyFact extends TechnologyFact {
  check: string;
}

/**
 * What the technology checks established about how the store is built, in catalog order:
 * "Theme: Block theme (twentytwentyfive)", "Checkout: Checkout block". Only checks that
 * ran and passed contribute, and only facts of the documented shape, so an older or
 * hand-edited result renders without them rather than with garbage.
 */
export function technologyFacts(
  result: ScanResult,
  catalog: Catalog = defaultCatalog,
): ShownTechnologyFact[] {
  const facts: ShownTechnologyFact[] = [];
  for (const item of shownResults(result, catalog)) {
    if (item.verdict !== 'pass' || definitionOf(item.id, catalog)?.technology !== true) continue;
    const listed = item.evidence.facts;
    if (!Array.isArray(listed)) continue;
    for (const fact of listed) {
      const parsed = TechnologyFactSchema.safeParse(fact);
      if (parsed.success) facts.push({ ...parsed.data, check: item.id });
    }
  }
  return facts;
}

/**
 * The platform line every report opens with: what the scan recognised and which
 * platform-specific checks ran because of it. Checks for other platforms are never named.
 */
export function platformSentence(result: ScanResult, catalog: Catalog = defaultCatalog): string {
  const label = platformLabel(result.target.platform);
  if (!label) return 'No platform recognised, so only the checks that apply to any site ran.';
  const ids = platformResults(result, catalog).map((item) => item.id);
  const name = result.target.platform === 'woocommerce' ? 'WooCommerce on WordPress' : label;
  if (ids.length === 0) return `${name}. The checks that apply to any site ran.`;
  return `${name}. ${String(ids.length)} platform-specific check${ids.length === 1 ? '' : 's'} ran: ${ids.join(', ')}.`;
}

export interface GroupedResults {
  id: string;
  /** The technical name: "Discoverability". */
  title: string;
  /** The plain name: "Findable". Falls back to the title. */
  label: string;
  /** The plain question the section answers, or the description when none is set. */
  question: string;
  dimension: Dimension;
  results: CheckResult[];
}

export function groupResults(
  result: ScanResult,
  catalog: Catalog = defaultCatalog,
): GroupedResults[] {
  return catalog.groups.map((group) => ({
    id: group.id,
    title: group.title,
    label: group.label ?? group.title,
    question: group.question ?? group.description,
    dimension: group.dimension,
    results: shownResults(result, catalog).filter((item) => item.group === group.id),
  }));
}

export function verdictSymbol(verdict: CheckResult['verdict']): string {
  switch (verdict) {
    case 'pass':
      return 'PASS';
    case 'warn':
      return 'WARN';
    case 'fail':
      return 'FAIL';
    case 'skip':
      return 'SKIP';
  }
}

/**
 * Why a store sits at Level 0, by the Level 1 gate it misses, in the order an agent meets
 * them: it cannot get in (A2.4, A1.1), it may not crawl (A2.2), or it gets in and reads
 * nothing (A3.2). Each cause has a short name for the heading and a sentence for the
 * reader. The level stays 0; only its explanation changes.
 */
const LEVEL_ZERO_CAUSES: readonly { gate: string; name: string; sentence: string }[] = [
  {
    gate: 'A2.4',
    name: 'Not reachable',
    sentence: 'An agent that says who it is gets a block or a challenge instead of the store.',
  },
  {
    gate: 'A1.1',
    name: 'Not reachable',
    sentence: 'robots.txt answers with an error, and crawlers then assume they may fetch nothing.',
  },
  {
    gate: 'A2.2',
    name: 'Closed to AI crawlers',
    sentence:
      'The site answers, but robots.txt keeps the crawlers behind AI answers away from product pages.',
  },
  {
    gate: 'A3.2',
    name: 'Not readable',
    sentence:
      'The site answers, but its product pages show no title, price or description until JavaScript runs. Most AI fetchers read the HTML without running scripts, so they see empty pages.',
  },
];

/** A3.2 has three Level 0 stories: empty product pages, an empty home page, or no product page read. */
const HOME_NOT_READABLE = {
  gate: 'A3.2',
  name: 'Not readable',
  sentence:
    'The site answers, but its home page is empty until JavaScript runs. Most AI fetchers read the HTML without running scripts, so they see nothing.',
};
const NO_PRODUCT_READ = {
  gate: 'A3.2',
  name: 'No product page found',
  sentence:
    'The scanner found no product page to read, so it cannot confirm that agents can read the catalog. List product pages in the sitemap or link them from the home page.',
};

function levelZeroCauses(result: ScanResult): (typeof LEVEL_ZERO_CAUSES)[number][] {
  if (result.level.value !== 0 || (result.level.undetermined?.length ?? 0) > 0) return [];
  const missed = new Set(result.level.next_gate);
  const content = result.results.find((item) => item.id === 'A3.2');
  return LEVEL_ZERO_CAUSES.filter((cause) => missed.has(cause.gate)).map((cause) => {
    if (cause.gate !== 'A3.2' || !content) return cause;
    if (content.verdict === 'skip') return NO_PRODUCT_READ;
    return content.evidence.judged === 'home' ? HOME_NOT_READABLE : cause;
  });
}

/**
 * The level's name as reports show it. Level 0 is named by its cause, so a site that
 * answers but shows agents nothing reads "Not readable", not "Not reachable". When the
 * scan could not answer what stands before Level 1, it reads "Not decided yet".
 */
export function levelLabel(result: ScanResult): string {
  if (result.level.value === 0 && (result.level.undetermined?.length ?? 0) > 0) {
    return 'Not decided yet';
  }
  return levelZeroCauses(result)[0]?.name ?? result.level.name;
}

/** One or two sentences on why a store is at Level 0, or '' at any other level. */
export function levelCauseSentence(result: ScanResult): string {
  return levelZeroCauses(result)
    .map((cause) => cause.sentence)
    .filter((sentence, index, all) => all.indexOf(sentence) === index)
    .join(' ');
}

export function nextGateSentence(result: ScanResult, catalog: Catalog = defaultCatalog): string {
  if (result.level.value >= 5) return 'This store has reached the highest level.';
  const next = catalog.levels.find((level) => level.value === result.level.value + 1);
  const gates = result.level.next_gate;
  const undetermined = result.level.undetermined ?? [];
  if (next && undetermined.length > 0) {
    const names = undetermined.map(
      (id) => result.results.find((item) => item.id === id)?.title ?? id,
    );
    return `Level ${next.value} (${next.name}) is not decided: ${names.join(' · ')} could not be checked in this scan (the site rate-limited it, refused it or did not answer in time). Scan again later to settle it.`;
  }
  if (!next || gates.length === 0) return '';
  const titles = gates.map((id) => result.results.find((item) => item.id === id)?.title ?? id);
  const count = gates.length === 1 ? 'One fix' : `${gates.length} fixes`;
  return `${count} to reach Level ${next.value} (${next.name}): ${titles.join(' · ')}.`;
}

export function failedResults(result: ScanResult): CheckResult[] {
  return result.results.filter((item) => item.verdict === 'fail' || item.verdict === 'warn');
}

export function countVerdicts(result: ScanResult): Record<CheckResult['verdict'], number> {
  const counts = { pass: 0, warn: 0, fail: 0, skip: 0 };
  for (const item of shownResults(result)) counts[item.verdict] += 1;
  return counts;
}

/**
 * What the scan looked at and what it cannot see, so a reader never mistakes a sampled,
 * render-free, unauthenticated scan for a full crawl. Plain sentences shared by every
 * surface.
 */
export function scopeLines(result: ScanResult): string[] {
  const sampled = result.target.sampled;
  const policies = Object.entries(sampled.policies);
  const lines: string[] = [];
  lines.push(
    `Pages read: the home page${sampled.listing ? `, the listing page ${sampled.listing}` : ''}${
      sampled.products.length > 0
        ? `, ${sampled.products.length} product page(s) (${sampled.products.join(', ')})`
        : ', no product pages (none were found to sample)'
    }${policies.length > 0 ? `, and ${policies.length} policy page(s) (${policies.map(([kind, url]) => `${kind}: ${url}`).join(', ')})` : ', and no policy pages'}.`,
  );
  lines.push(
    `Method: ${result.requests} HTTP request(s) as AgenticReadinessScanner, honouring robots.txt, without running JavaScript, signing in, accepting cookies or impersonating any other agent. Content rendered in the browser, prices shown only after sign-in and region-specific variants are outside what this scan can see. A page it could not fetch is reported, never scored.`,
  );
  return lines;
}
