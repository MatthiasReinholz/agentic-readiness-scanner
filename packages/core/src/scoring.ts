/**
 * Scoring is a pure function of results and the catalog's levels. It is versioned
 * separately from the catalog (scoring_version) so a scoring change never alters evidence.
 */
import {
  catalog as defaultCatalog,
  checksForProfile,
  type Catalog,
  type CheckResult,
  type Dimension,
  type LevelResult,
  type Profile,
  type ScoredDimension,
  type Scores,
} from '@agentic-readiness/catalog';

function weightOf(result: CheckResult): number {
  return result.weight === 'info' ? 0 : result.weight;
}

/** Below this share of answered weight a score would stand on a sliver of the catalog. */
export const MIN_SCORE_COVERAGE = 50;

const UNANSWERED_REASONS = new Set<CheckResult['skip_reason']>([
  'budget_exhausted',
  'error',
  'not_implemented',
]);

/**
 * True when a check applied but the scan could not answer it: the time or request budget
 * ran out, it errored, it is not implemented, or its parent could not run for one of those
 * reasons. A dependent of a parent that failed is answered: the parent's failure carries
 * the finding. A check that did not apply is neither answered nor unanswered.
 */
export function isUnanswered(
  result: CheckResult,
  byId: ReadonlyMap<string, CheckResult> = new Map(),
  seen = new Set<string>(),
): boolean {
  if (result.verdict !== 'skip') return false;
  if (UNANSWERED_REASONS.has(result.skip_reason)) return true;
  if (result.skip_reason !== 'dependency_failed') return false;
  const parentId = result.evidence.dependency;
  if (typeof parentId !== 'string' || seen.has(parentId)) return false;
  const parent = byId.get(parentId);
  if (!parent) return false;
  seen.add(result.id);
  return isUnanswered(parent, byId, seen);
}

interface WeightedOutcome {
  score: number | null;
  /** Answered share of the applicable weight, 0 to 100; null when nothing applied. */
  coverage: number | null;
}

function weighted(
  results: Iterable<CheckResult>,
  byId: ReadonlyMap<string, CheckResult>,
): WeightedOutcome {
  let earned = 0;
  let possible = 0;
  let unanswered = 0;
  for (const result of results) {
    const weight = weightOf(result);
    if (weight === 0) continue;
    if (result.verdict === 'skip') {
      if (isUnanswered(result, byId)) unanswered += weight;
      continue;
    }
    possible += weight;
    if (result.verdict === 'pass') earned += weight;
    else if (result.verdict === 'warn') earned += weight / 2;
  }
  const applicable = possible + unanswered;
  const coverage = applicable === 0 ? null : Math.round((possible / applicable) * 100);
  return {
    score: possible === 0 ? null : Math.round((earned / possible) * 100),
    coverage,
  };
}

/**
 * Sum of weights of passed checks (warn counts half) over the sum of weights of
 * answered checks, as a 0 to 100 integer. Skipped and info-only checks drop out of
 * the denominator; null when nothing applied. Callers that need to know whether enough
 * of the catalog was answered use scoreWithCoverage.
 */
export function weightedScore(results: Iterable<CheckResult>): number | null {
  return weighted(results, new Map()).score;
}

/**
 * The weighted score and the share of applicable weight it rests on. The score is null
 * when that share is below MIN_SCORE_COVERAGE: a scan that ran out of time after one
 * passing check must not report 100.
 */
export function scoreWithCoverage(
  results: readonly CheckResult[],
  all: readonly CheckResult[] = results,
): WeightedOutcome {
  const outcome = weighted(results, new Map(all.map((result) => [result.id, result])));
  if (outcome.coverage !== null && outcome.coverage < MIN_SCORE_COVERAGE) {
    return { score: null, coverage: outcome.coverage };
  }
  return outcome;
}

function dimensionResults(
  results: readonly CheckResult[],
  dimension: Dimension,
  catalog: Catalog,
): CheckResult[] {
  const groupIds = new Set(
    catalog.groups.filter((group) => group.dimension === dimension).map((group) => group.id),
  );
  return results.filter((result) => groupIds.has(result.group));
}

export function scoreDimension(
  results: readonly CheckResult[],
  dimension: Dimension,
  catalog: Catalog = defaultCatalog,
): number | null {
  return scoreWithCoverage(dimensionResults(results, dimension, catalog), results).score;
}

/** The same weighted ratio for one catalog group, so a report can score each section. */
export function scoreGroup(results: readonly CheckResult[], groupId: string): number | null {
  return scoreWithCoverage(
    results.filter((result) => result.group === groupId),
    results,
  ).score;
}

export function computeScores(
  results: readonly CheckResult[],
  catalog: Catalog = defaultCatalog,
): Scores {
  const groups: Record<string, number | null> = {};
  for (const group of catalog.groups) groups[group.id] = scoreGroup(results, group.id);
  const ingestion = dimensionResults(results, 'ingestion', catalog);
  const commerce = scoreWithCoverage(dimensionResults(results, 'commerce', catalog), results);
  return {
    // Every profile carries ingestion checks, so null only happens when none of them could
    // be scored (all skipped, or a custom catalog). The contract keeps ingestion non-null
    // because every consumer ranks on it; "nothing could be scored" reads as 0, not as a
    // missing number, and a low coverage marks it incomplete. Commerce is null for profiles
    // without that dimension and when too little of it was answered.
    ingestion: weighted(ingestion, new Map(results.map((r) => [r.id, r]))).score ?? 0,
    commerce: commerce.score,
    groups,
    coverage: {
      ingestion: scoreWithCoverage(ingestion, results).coverage,
      commerce: commerce.coverage,
    },
  };
}

export type ScoreState = 'scored' | 'incomplete' | 'not_applicable';

export interface DimensionScore {
  value: number | null;
  state: ScoreState;
  /** Answered share of the applicable weight; null for results written before scoring 0.5.0. */
  coverage: number | null;
}

/**
 * How a report should present one dimension: a score, "incomplete" when the scan answered
 * too little of it to stand on, or "not applicable" for a profile without the dimension.
 */
export function dimensionScore(scores: Scores, dimension: ScoredDimension): DimensionScore {
  const coverage = scores.coverage?.[dimension] ?? null;
  const value = scores[dimension];
  if (coverage !== null && coverage < MIN_SCORE_COVERAGE) {
    return { value: null, state: 'incomplete', coverage };
  }
  if (value === null) return { value: null, state: 'not_applicable', coverage };
  return { value, state: 'scored', coverage };
}

/** One sentence for an incomplete dimension, shared by every surface. */
export function incompleteScoreSentence(score: DimensionScore): string {
  return `Not scored: only ${String(score.coverage ?? 0)}% of the weighted checks could be answered before the scan's time or request budget ran out, too little for a score. The verdicts it reached are listed below.`;
}

/**
 * A gate is satisfied when one alternative passed, or when every alternative is outside
 * the profile's catalog (a content site is not held back by product gates). A check the
 * profile does include but that could not run on this target (no product pages found,
 * dependency failed, not implemented) blocks the gate: the scanner never awards a level
 * it could not verify. Without a profile the runtime `not_applicable` skip is the only
 * signal available and is treated as outside the catalog.
 */
function gateSatisfied(
  gate: readonly string[],
  results: ReadonlyMap<string, CheckResult>,
  inProfile: ReadonlySet<string> | null,
): boolean {
  if (gate.some((id) => results.get(id)?.verdict === 'pass')) return true;
  return gate.every((id) => {
    if (inProfile) return !inProfile.has(id);
    const result = results.get(id);
    return result?.verdict === 'skip' && result.skip_reason === 'not_applicable';
  });
}

/**
 * Levels are gates, not averages: a target holds a level only when every gate of that
 * level has at least one passing alternative. next_gate lists what blocks the next level.
 * maxLevel caps the result for profiles that cannot reach commerce levels.
 */
export function computeLevel(
  results: readonly CheckResult[],
  catalog: Catalog = defaultCatalog,
  profile?: Profile,
): LevelResult {
  const byId = new Map(results.map((result) => [result.id, result]));
  const platformBound = new Set(
    catalog.checks
      .filter((check) => check.requires.some((req) => req === 'woocommerce' || req === 'shopify'))
      .map((check) => check.id),
  );
  const maxLevel = profile?.max_level ?? 5;
  const inProfile = profile
    ? new Set(checksForProfile(profile, catalog).map((definition) => definition.id))
    : null;
  const levels = [...catalog.levels]
    .sort((a, b) => a.value - b.value)
    .filter((level) => level.value <= maxLevel);
  let reached = levels[0];
  for (const level of levels) {
    if (level.gates.every((gate) => gateSatisfied(gate, byId, inProfile))) reached = level;
    else break;
  }
  if (!reached) {
    return { value: 0, name: 'Not reachable', next_gate: [] };
  }
  const next = levels.find((level) => level.value === reached.value + 1);
  // Alternatives outside the profile (a WooCommerce-only check on a Shopify store) are
  // not something the owner can act on, so the gate lists only the ones that apply.
  const nextGate = next
    ? next.gates
        .filter((gate) => !gateSatisfied(gate, byId, inProfile))
        .flatMap((gate) => [...gate])
        .filter((id) => (inProfile ? inProfile.has(id) : true))
        // A platform the target does not run (a Shopify-only check on another platform) is
        // not something the owner can act on either; a missing product sample is.
        .filter((id) => !(platformBound.has(id) && byId.get(id)?.skip_reason === 'not_applicable'))
    : [];
  return { value: reached.value, name: reached.name, next_gate: [...new Set(nextGate)] };
}
