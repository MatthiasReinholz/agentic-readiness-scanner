import {
  catalog as defaultCatalog,
  checksForProfile,
  type Catalog,
  type CheckDefinition,
  type CheckResult,
  type Verdict,
  type Requirement,
} from '@agentic-readiness/catalog';

import { BudgetExhaustedError, type Fetcher } from './http/types.js';
import type { Check, CheckOutcome } from './checks/types.js';
import type { Target } from './target/types.js';

export interface RunOptions {
  target: Target;
  fetcher: Fetcher;
  checks: readonly Check[];
  catalog?: Catalog;
}

export interface RunOutput {
  results: CheckResult[];
  outcomes: Map<string, CheckOutcome>;
}

/** Stable topological order: dependencies first, catalog order otherwise. */
export function orderByDependencies(definitions: readonly CheckDefinition[]): CheckDefinition[] {
  const byId = new Map(definitions.map((definition) => [definition.id, definition]));
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
  for (const definition of definitions) visit(definition);
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
  const applicable = new Set(checksForProfile(target.profile).map((definition) => definition.id));
  const outcomes = new Map<string, CheckOutcome>();
  let budgetExhausted = false;

  for (const definition of orderByDependencies(catalog.checks)) {
    // A home page that refused the scanner leaves nothing to read: only robots.txt, the
    // sitemap and the refusal itself can be judged. Everything else would report the
    // absence of things the scanner never saw.
    if (target.blocked && !runsWhenHomeBlocked(definition.id, target)) {
      outcomes.set(definition.id, {
        verdict: 'skip',
        skipReason: 'dependency_failed',
        message: `not evaluated: the home page refused the scanner (HTTP ${target.blocked.status}); see A2.4`,
        evidence: { dependency: 'A2.4' },
      });
      continue;
    }
    const unmet = applicable.has(definition.id) ? unmetRequirement(definition, target) : null;
    if (!applicable.has(definition.id) || unmet) {
      outcomes.set(definition.id, {
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
      outcomes.set(
        definition.id,
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
      outcomes.set(definition.id, {
        verdict: 'skip',
        skipReason: 'not_implemented',
        message: 'not implemented in this scanner version',
        evidence: {},
      });
      continue;
    }
    if (budgetExhausted) {
      outcomes.set(definition.id, {
        verdict: 'skip',
        skipReason: 'budget_exhausted',
        message: 'request budget exhausted before this check ran',
        evidence: {},
      });
      continue;
    }
    try {
      outcomes.set(
        definition.id,
        await implementation.run({ target, fetcher, definition, outcomes }),
      );
    } catch (error) {
      if (error instanceof BudgetExhaustedError) {
        budgetExhausted = true;
        outcomes.set(definition.id, {
          verdict: 'skip',
          skipReason: 'budget_exhausted',
          message: error.message,
          evidence: {},
        });
      } else {
        outcomes.set(definition.id, {
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
  return { results, outcomes };
}
