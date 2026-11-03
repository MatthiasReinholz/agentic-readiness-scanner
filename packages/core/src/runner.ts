import {
  catalog as defaultCatalog,
  checksForProfile,
  type Catalog,
  type CheckDefinition,
  type CheckResult,
  type Verdict,
  type Requirement,
} from '@agentic-readiness/catalog';

import { BudgetExhaustedError, StepDeadlineError, type Fetcher } from './http/types.js';
import type { Check, CheckOutcome } from './checks/types.js';
import type { Target } from './target/types.js';
import { emitProgress, type ProgressListener } from './progress.js';

export interface RunOptions {
  target: Target;
  fetcher: Fetcher;
  checks: readonly Check[];
  catalog?: Catalog;
  /** Receives a check event as each verdict is decided. */
  onProgress?: ProgressListener;
  /**
   * Resumable scans: outcomes an earlier step already decided. They are taken as they
   * are, in their place in the order, and their checks do not run again.
   */
  prior?: ReadonlyMap<string, CheckOutcome>;
}

export interface RunOutput {
  results: CheckResult[];
  outcomes: Map<string, CheckOutcome>;
  /**
   * True when a step deadline stopped the run: `outcomes` holds what was decided, the
   * interrupted check and those after it run in the next step, and `results` is not final.
   */
  interrupted: boolean;
}

/** Stable topological order: dependencies first, catalog order otherwise. */
/**
 * How early a check runs when time or requests may run out: level gates and blocking
 * checks first, then expected, nice to have and informational ones. Output order does not
 * change (results follow the catalog); only which checks a short budget reaches does.
 */
function urgency(definition: CheckDefinition, gates: ReadonlySet<string>): number {
  if (gates.has(definition.id) || definition.weight === 3) return 0;
  if (definition.weight === 2) return 1;
  if (definition.weight === 1) return 2;
  return 3;
}

/**
 * Dependency order with the most urgent checks first. A parent inherits the urgency of
 * its most urgent dependent, so a blocking check never waits behind optional probes for
 * the parent it needs. Ties keep catalog order, so the order is deterministic.
 */
export function orderByDependencies(
  definitions: readonly CheckDefinition[],
  gates: ReadonlySet<string> = new Set(),
): CheckDefinition[] {
  const byId = new Map(definitions.map((definition) => [definition.id, definition]));
  const position = new Map(definitions.map((definition, index) => [definition.id, index]));
  const children = new Map<string, string[]>();
  for (const definition of definitions) {
    for (const parent of definition.depends_on) {
      if (!byId.has(parent)) continue;
      children.set(parent, [...(children.get(parent) ?? []), definition.id]);
    }
  }
  const effective = new Map<string, number>();
  const effectiveUrgency = (id: string, visiting: Set<string> = new Set()): number => {
    const known = effective.get(id);
    if (known !== undefined) return known;
    const definition = byId.get(id);
    if (!definition || visiting.has(id)) return 3;
    visiting.add(id);
    let value = urgency(definition, gates);
    for (const child of children.get(id) ?? []) {
      value = Math.min(value, effectiveUrgency(child, visiting));
    }
    visiting.delete(id);
    effective.set(id, value);
    return value;
  };
  const ordered: CheckDefinition[] = [];
  const placed = new Set<string>();
  const visiting = new Set<string>();
  const visit = (definition: CheckDefinition): void => {
    if (placed.has(definition.id) || visiting.has(definition.id)) return;
    visiting.add(definition.id);
    for (const dependency of definition.depends_on) {
      const parent = byId.get(dependency);
      if (parent) visit(parent);
    }
    visiting.delete(definition.id);
    placed.add(definition.id);
    ordered.push(definition);
  };
  const byUrgency = [...definitions].sort(
    (a, b) =>
      effectiveUrgency(a.id) - effectiveUrgency(b.id) ||
      (position.get(a.id) ?? 0) - (position.get(b.id) ?? 0),
  );
  for (const definition of byUrgency) visit(definition);
  return ordered;
}

/** The first requirement the target does not meet, or null when the check applies. */
function unmetRequirement(definition: CheckDefinition, target: Target): Requirement | null {
  for (const requirement of definition.requires) {
    if (requirement === 'woocommerce' && target.platform !== 'woocommerce') return requirement;
    if (requirement === 'shopify' && target.platform !== 'shopify') return requirement;
    if (requirement === 'products' && target.sampled.products.length === 0) return requirement;
  }
  return null;
}

/** Checks that read only robots.txt (when it parsed), the sitemap (when one answered) or the refusal itself. */
const ROBOTS_CHECKS: ReadonlySet<string> = new Set(['A2.1', 'A2.2', 'A2.3', 'A2.5']);
const SITEMAP_CHECKS: ReadonlySet<string> = new Set(['A1.2', 'A1.3', 'A1.7']);

function runsWhenHomeBlocked(id: string, target: Target): boolean {
  if (id === 'A1.1' || id === 'A2.4') return true;
  // "every crawler may read the page" would be false comfort when robots.txt was refused too.
  if (ROBOTS_CHECKS.has(id)) return target.robots !== null;
  if (SITEMAP_CHECKS.has(id)) return target.sitemap !== null;
  return false;
}

const UNMET_MESSAGES: Record<Requirement, string> = {
  woocommerce: 'requires WooCommerce, which was not detected',
  shopify: 'requires Shopify, which was not detected',
  products: 'no product pages were found to sample',
};

function toResult(
  definition: CheckDefinition,
  outcome: CheckOutcome,
  applies: boolean,
): CheckResult {
  const includeFix = outcome.verdict === 'fail' || outcome.verdict === 'warn';
  return {
    id: definition.id,
    group: definition.group,
    title: definition.title,
    weight: definition.weight,
    verdict: outcome.verdict,
    applies,
    ...(outcome.skipReason ? { skip_reason: outcome.skipReason } : {}),
    ...(outcome.message ? { message: outcome.message } : {}),
    evidence: outcome.evidence,
    ...(includeFix ? { fix: definition.fix } : {}),
  };
}

/**
 * Runs every applicable catalog check in dependency order. Checks run sequentially so
 * the request budget is consumed deterministically; results come back in catalog order.
 */
export async function runChecks(options: RunOptions): Promise<RunOutput> {
  const catalog = options.catalog ?? defaultCatalog;
  const { target, fetcher } = options;
  const implementations = new Map(options.checks.map((check) => [check.id, check]));
  const applicable = new Set(
    checksForProfile(target.profile, catalog).map((definition) => definition.id),
  );
  const outcomes = new Map<string, CheckOutcome>();
  const total = catalog.checks.length;
  let decided = 0;
  const record = (definition: CheckDefinition, outcome: CheckOutcome): void => {
    outcomes.set(definition.id, outcome);
    decided += 1;
    emitProgress(options.onProgress, {
      type: 'check',
      id: definition.id,
      group: definition.group,
      title: definition.title,
      verdict: outcome.verdict,
      ...(outcome.skipReason ? { skip_reason: outcome.skipReason } : {}),
      ...(outcome.message ? { message: outcome.message } : {}),
      index: decided,
      total,
    });
  };
  let budgetExhausted = false;
  let interrupted = false;
  let stopReason = 'request budget exhausted before this check ran';

  const gates = new Set(catalog.levels.flatMap((level) => level.gates.flat()));
  for (const definition of orderByDependencies(catalog.checks, gates)) {
    const decided = options.prior?.get(definition.id);
    if (decided) {
      record(definition, decided);
      continue;
    }
    // A home page that refused the scanner leaves nothing to read: only robots.txt, the
    // sitemap and the refusal itself can be judged. Everything else would report the
    // absence of things the scanner never saw.
    if (target.blocked && !runsWhenHomeBlocked(definition.id, target)) {
      record(definition, {
        verdict: 'skip',
        skipReason: 'dependency_failed',
        message: `not evaluated: the home page refused the scanner (HTTP ${target.blocked.status}); see A2.4`,
        evidence: { dependency: 'A2.4' },
      });
      continue;
    }
    const unmet = applicable.has(definition.id) ? unmetRequirement(definition, target) : null;
    if (!applicable.has(definition.id) || unmet) {
      record(definition, {
        verdict: 'skip',
        skipReason: 'not_applicable',
        message: unmet ? UNMET_MESSAGES[unmet] : 'does not apply to this profile',
        evidence: {},
      });
      continue;
    }
    const failedParent = definition.depends_on.find((parent) => {
      const parentOutcome = outcomes.get(parent);
      const verdict: Verdict | undefined = parentOutcome?.verdict;
      return verdict === 'fail' || verdict === 'skip';
    });
    if (failedParent) {
      // A parent that had nothing to evaluate (an optional file that is absent, say)
      // leaves its dependents with nothing to evaluate either; that is not a failure.
      const parentSkip = outcomes.get(failedParent)?.skipReason;
      if (parentSkip === 'budget_exhausted') {
        // The parent never ran, so neither can this check: it is unanswered, not blocked.
        record(definition, {
          verdict: 'skip',
          skipReason: 'budget_exhausted',
          message: `not run: ${failedParent} could not run before the budget ran out`,
          evidence: { dependency: failedParent },
        });
        continue;
      }
      record(
        definition,
        parentSkip === 'not_applicable'
          ? {
              verdict: 'skip',
              skipReason: 'not_applicable',
              message: `does not apply because ${failedParent} did not apply`,
              evidence: { dependency: failedParent },
            }
          : {
              verdict: 'skip',
              skipReason: 'dependency_failed',
              message: `skipped because ${failedParent} did not pass`,
              evidence: { dependency: failedParent },
            },
      );
      continue;
    }
    const implementation = implementations.get(definition.id);
    if (!implementation) {
      record(definition, {
        verdict: 'skip',
        skipReason: 'not_implemented',
        message: 'not implemented in this scanner version',
        evidence: {},
      });
      continue;
    }
    if (budgetExhausted) {
      record(definition, {
        verdict: 'skip',
        skipReason: 'budget_exhausted',
        message: stopReason,
        evidence: {},
      });
      continue;
    }
    try {
      record(definition, await implementation.run({ target, fetcher, definition, outcomes }));
    } catch (error) {
      if (error instanceof StepDeadlineError) {
        interrupted = true;
        break;
      }
      if (error instanceof BudgetExhaustedError) {
        budgetExhausted = true;
        if (error.name === 'RateLimitedError' || error.name === 'DeadlineExhaustedError')
          stopReason = `not run: ${error.message} before this check`;
        record(definition, {
          verdict: 'skip',
          skipReason: 'budget_exhausted',
          message: error.message,
          evidence: {},
        });
      } else {
        record(definition, {
          verdict: 'skip',
          skipReason: 'error',
          message: error instanceof Error ? `${error.name}: ${error.message}` : String(error),
          evidence: {},
        });
      }
    }
  }

  const results = catalog.checks.map((definition) => {
    const outcome = outcomes.get(definition.id) ?? {
      verdict: 'skip' as const,
      skipReason: 'error' as const,
      evidence: {},
    };
    // `applies` mirrors the contract in result.ts: false only for not_applicable, whether
    // the runner decided that (profile, platform) or the check did (nothing to sample).
    const applies = outcome.skipReason !== 'not_applicable';
    return toResult(definition, outcome, applies);
  });
  return { results, outcomes, interrupted };
}
