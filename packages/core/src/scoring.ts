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
  type Scores,
} from '@agentic-readiness/catalog';

function weightOf(result: CheckResult): number {
  return result.weight === 'info' ? 0 : result.weight;
}

/**
 * Sum of weights of passed checks (warn counts half) over the sum of weights of
 * applicable checks, as a 0 to 100 integer. Skipped and info-only checks drop out of
 * the denominator; null when nothing applied.
 */
export function weightedScore(results: Iterable<CheckResult>): number | null {
  let earned = 0;
  let possible = 0;
  for (const result of results) {
    if (result.verdict === 'skip' || weightOf(result) === 0) continue;
    possible += weightOf(result);
    if (result.verdict === 'pass') earned += weightOf(result);
    else if (result.verdict === 'warn') earned += weightOf(result) / 2;
  }
  if (possible === 0) return null;
  return Math.round((earned / possible) * 100);
}

export function scoreDimension(
  results: readonly CheckResult[],
  dimension: Dimension,
  catalog: Catalog = defaultCatalog,
): number | null {
  const groupIds = new Set(
    catalog.groups.filter((group) => group.dimension === dimension).map((group) => group.id),
  );
  return weightedScore(results.filter((result) => groupIds.has(result.group)));
}

/** The same weighted ratio for one catalog group, so a report can score each section. */
export function scoreGroup(results: readonly CheckResult[], groupId: string): number | null {
  return weightedScore(results.filter((result) => result.group === groupId));
}

export function computeScores(
  results: readonly CheckResult[],
  catalog: Catalog = defaultCatalog,
): Scores {
  const groups: Record<string, number | null> = {};
  for (const group of catalog.groups) groups[group.id] = scoreGroup(results, group.id);
  return {
    // Every profile carries ingestion checks, so null only happens when none of them could
    // be scored (all skipped, or a custom catalog). The contract keeps ingestion non-null
    // because every consumer ranks on it; "nothing could be scored" reads as 0, not as a
    // missing number, while commerce stays null for profiles without that dimension.
    ingestion: scoreDimension(results, 'ingestion', catalog) ?? 0,
    commerce: scoreDimension(results, 'commerce', catalog),
    groups,
  };
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
    : [];
  return { value: reached.value, name: reached.name, next_gate: [...new Set(nextGate)] };
}
