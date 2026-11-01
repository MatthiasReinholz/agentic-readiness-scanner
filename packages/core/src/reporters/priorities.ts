/**
 * What a merchant should do first.
 *
 * The catalog already says how much a check matters (weight 3 blocks agents, 2 is
 * expected, 1 is nice to have, info is never scored) and the level says which checks
 * stand between the store and the next level. Reports used to list findings in catalog
 * order, so a missing A2A agent card came before a product page without an Offer. This
 * module turns the open findings into an ordered, tiered list that every surface (HTML,
 * Markdown, MCP) renders the same way. Pure: it reads the result and the catalog only.
 */
import {
  catalog as defaultCatalog,
  type Catalog,
  type CheckResult,
  type ScanResult,
} from '@agentic-readiness/catalog';

/** Presentation tier of a check, from its catalog weight. */
export type Tier = 'blocking' | 'expected' | 'nice_to_have' | 'informational';

export const TIER_LABEL: Record<Tier, string> = {
  blocking: 'blocking',
  expected: 'expected',
  nice_to_have: 'nice to have',
  informational: 'informational',
};

export function tierOf(weight: CheckResult['weight']): Tier {
  switch (weight) {
    case 3:
      return 'blocking';
    case 2:
      return 'expected';
    case 1:
      return 'nice_to_have';
    case 'info':
      return 'informational';
  }
}

export interface Priority {
  result: CheckResult;
  tier: Tier;
  /** The level this finding stands in the way of, when it is in the next gate. */
  unlocks: number | null;
  /** True when the catalog marks the fix as mechanical. */
  mechanical: boolean;
}

export interface Priorities {
  /** Next-gate checks and every other blocking finding, in that order. */
  first: Priority[];
  /** Expected findings that are not in the next gate. */
  next: Priority[];
  /** Nice-to-have findings: conventions and optional protocols. */
  optional: Priority[];
  /** Informational findings: reported, never scored. */
  informational: Priority[];
  /** Open findings per tier, for summary lines. */
  counts: Record<Tier, number>;
}

const TIER_RANK: Record<Tier, number> = {
  blocking: 0,
  expected: 1,
  nice_to_have: 2,
  informational: 3,
};

const VERDICT_RANK: Record<CheckResult['verdict'], number> = { fail: 0, warn: 1, pass: 2, skip: 3 };

/**
 * Orders open findings (fail and warn) by what unlocks the next level first, then by
 * tier, then fail before warn, then catalog order, and splits them into the lists a
 * report shows. A next-gate check always lands in `first`, whatever its weight.
 */
export function prioritize(result: ScanResult, catalog: Catalog = defaultCatalog): Priorities {
  const gate = new Set(result.level.next_gate);
  const nextLevel = result.level.value + 1;
  const order = new Map(catalog.checks.map((check, index) => [check.id, index]));
  const open = result.results.filter((item) => item.verdict === 'fail' || item.verdict === 'warn');
  const priorities: Priority[] = open.map((item) => ({
    result: item,
    tier: tierOf(item.weight),
    unlocks: gate.has(item.id) ? nextLevel : null,
    mechanical: item.fix?.auto_fix === true,
  }));
  priorities.sort((a, b) => {
    const gateOrder = Number(a.unlocks === null) - Number(b.unlocks === null);
    if (gateOrder !== 0) return gateOrder;
    const tierOrder = TIER_RANK[a.tier] - TIER_RANK[b.tier];
    if (tierOrder !== 0) return tierOrder;
    const verdictOrder = VERDICT_RANK[a.result.verdict] - VERDICT_RANK[b.result.verdict];
    if (verdictOrder !== 0) return verdictOrder;
    return (order.get(a.result.id) ?? 0) - (order.get(b.result.id) ?? 0);
  });
  const counts: Record<Tier, number> = {
    blocking: 0,
    expected: 0,
    nice_to_have: 0,
    informational: 0,
  };
  for (const priority of priorities) counts[priority.tier] += 1;
  return {
    first: priorities.filter((p) => p.unlocks !== null || p.tier === 'blocking'),
    next: priorities.filter((p) => p.unlocks === null && p.tier === 'expected'),
    optional: priorities.filter((p) => p.unlocks === null && p.tier === 'nice_to_have'),
    informational: priorities.filter((p) => p.unlocks === null && p.tier === 'informational'),
    counts,
  };
}

/**
 * Skips split into the two kinds a reader cares about: checks that did not apply to this
 * target (profile, platform, no product pages) and checks that applied but could not be
 * answered (dependency failed, not implemented, budget, error).
 */
export function countSkips(result: ScanResult): { not_applicable: number; unanswered: number } {
  let notApplicable = 0;
  let unanswered = 0;
  for (const item of result.results) {
    if (item.verdict !== 'skip') continue;
    if (item.skip_reason === 'not_applicable') notApplicable += 1;
    else unanswered += 1;
  }
  return { not_applicable: notApplicable, unanswered };
}

/** True when every applicable check of a group is nice to have or informational. */
export function groupIsOptional(results: readonly CheckResult[]): boolean {
  const applicable = results.filter((item) => item.applies);
  return (
    applicable.length > 0 && applicable.every((item) => item.weight === 1 || item.weight === 'info')
  );
}
