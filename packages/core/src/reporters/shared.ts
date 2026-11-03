import {
  catalog as defaultCatalog,
  forOtherPlatform,
  PLATFORM_LABEL,
  requiredPlatform,
  type Catalog,
  type CheckResult,
  type Dimension,
  type ScanResult,
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
    ? `Capped at ${String(ceiling.value)} while ${ceiling.reason}; ${String(ceiling.raw)} without the cap.${lift}`
    : `Cannot exceed ${String(ceiling.value)} while ${ceiling.reason}.${lift}`;
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

/** One sentence naming the platform checks a report leaves out, or null when none are. */
export function leftOutSentence(
  result: ScanResult,
  catalog: Catalog = defaultCatalog,
): string | null {
  const counts = new Map<'woocommerce' | 'shopify', number>();
  for (const item of result.results) {
    const definition = definitionOf(item.id, catalog);
    if (!definition || !forOtherPlatform(definition, result.target.platform)) continue;
    const platform = requiredPlatform(definition);
    if (platform) counts.set(platform, (counts.get(platform) ?? 0) + 1);
  }
  if (counts.size === 0) return null;
  const parts = [...counts].map(([platform, count]) => `${count} ${PLATFORM_LABEL[platform]}`);
  const detected = result.target.platform;
  const reason =
    detected === 'unknown'
      ? counts.size > 1
        ? 'neither platform was detected'
        : 'the platform was not detected'
      : `the scan detected ${detected === 'wordpress' ? 'WordPress without WooCommerce' : PLATFORM_LABEL[detected]}`;
  return `${parts.join(' and ')} check(s) left out, because ${reason}.`;
}

export interface GroupedResults {
  id: string;
  title: string;
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

export function nextGateSentence(result: ScanResult, catalog: Catalog = defaultCatalog): string {
  if (result.level.value >= 5) return 'This store has reached the highest level.';
  const next = catalog.levels.find((level) => level.value === result.level.value + 1);
  const gates = result.level.next_gate;
  if (!next || gates.length === 0) return '';
  const titles = gates.map((id) => {
    const found = result.results.find((item) => item.id === id);
    return found ? `${id} ${found.title}` : id;
  });
  const count = gates.length === 1 ? 'One check stands' : `${gates.length} checks stand`;
  return `${count} between you and Level ${next.value} (${next.name}): ${titles.join('; ')}.`;
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
    }${policies.length > 0 ? `, and ${policies.length} policy page(s) (${policies.map(([kind, url]) => `${kind}: ${url}`).join('; ')})` : ', and no policy pages'}.`,
  );
  lines.push(
    `Method: ${result.requests} HTTP request(s) as AgenticReadinessScanner, honouring robots.txt, without running JavaScript, signing in, accepting cookies or impersonating any other agent. Content rendered in the browser, prices shown only after sign-in and region-specific variants are outside what this scan can see; a page it could not fetch is reported, never scored.`,
  );
  return lines;
}
