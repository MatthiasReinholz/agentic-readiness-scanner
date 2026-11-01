import {
  catalog as defaultCatalog,
  type Catalog,
  type CheckResult,
  type ScanResult,
} from '@agentic-readiness/catalog';

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export interface GroupedResults {
  id: string;
  title: string;
  dimension: 'ingestion' | 'commerce';
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
    results: result.results.filter((item) => item.group === group.id),
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
  for (const item of result.results) counts[item.verdict] += 1;
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
