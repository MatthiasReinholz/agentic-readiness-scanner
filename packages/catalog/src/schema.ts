/**
 * Catalog schema.
 *
 * The catalog is data, not code: check definitions, groups, levels, profiles and fixes
 * live in JSON and Markdown under `data/` and `fixes/`. This schema is the contract that
 * every consumer (the engine, the docs generator, the MCP tools and anyone reading the
 * published catalog.json) relies on. Changing it is a catalog release.
 */
import { z } from 'zod';

export const CHECK_ID_PATTERN = /^[AB][1-5]\.\d{1,2}$/;
export const GROUP_ID_PATTERN = /^[AB][1-5]$/;

export const DimensionSchema = z.enum(['ingestion', 'commerce']);
export type Dimension = z.infer<typeof DimensionSchema>;

/** 1 = nice to have, 2 = expected, 3 = blocking for agents, "info" = reported, never scored. */
export const WeightSchema = z.union([z.literal(1), z.literal(2), z.literal(3), z.literal('info')]);
export type Weight = z.infer<typeof WeightSchema>;

export const VerdictSchema = z.enum(['pass', 'warn', 'fail', 'skip']);
export type Verdict = z.infer<typeof VerdictSchema>;

/** Platform tags a check may require. A check tagged `woocommerce` is skipped elsewhere. */
/**
 * What a target must offer for a check to apply: `woocommerce` or `shopify` (the
 * platform was detected) or `products` (product pages were found to sample). A profile
 * lists the requirements it can never satisfy; the runner evaluates the rest per target.
 */
export const RequirementSchema = z.enum(['woocommerce', 'shopify', 'products']);
export type Requirement = z.infer<typeof RequirementSchema>;
/** @deprecated Use RequirementSchema; kept for one release for external readers. */
export const PlatformRequirementSchema = RequirementSchema;
export type PlatformRequirement = Requirement;

export const SpecReferenceSchema = z.object({
  title: z.string().min(1),
  url: z.url({ protocol: /^https$/ }),
});
export type SpecReference = z.infer<typeof SpecReferenceSchema>;

export const FixSchema = z.object({
  /** One or two sentences a merchant can act on. */
  summary: z.string().min(1),
  /** A file or code snippet when one exists. */
  snippet: z.string().min(1).optional(),
  snippet_language: z.string().min(1).optional(),
  /** A self-contained prompt for a coding agent. */
  agent_prompt: z.string().min(1),
  /**
   * True when the fix is mechanical: a file, setting or markup change a tool or agent
   * can apply from the store's existing data without product knowledge or copywriting.
   */
  auto_fix: z.boolean(),
});
export type Fix = z.infer<typeof FixSchema>;

export const GroupSchema = z.object({
  id: z.string().regex(GROUP_ID_PATTERN),
  title: z.string().min(1),
  dimension: DimensionSchema,
  description: z.string().min(1),
});
export type Group = z.infer<typeof GroupSchema>;

export const CheckDefinitionSchema = z.object({
  id: z.string().regex(CHECK_ID_PATTERN),
  group: z.string().regex(GROUP_ID_PATTERN),
  title: z.string().min(1),
  /** The one question the check answers. */
  question: z.string().min(1),
  /** How the verdict is reached, in one or two sentences. */
  method: z.string().min(1),
  weight: WeightSchema,
  /** Requirements the target must meet for the check to apply (see RequirementSchema). */
  requires: z.array(RequirementSchema).default([]),
  /** Checks whose failure makes this check meaningless; the runner skips dependents. */
  depends_on: z.array(z.string().regex(CHECK_ID_PATTERN)).default([]),
  /** Public specifications the check is grounded in. A check without one does not ship. */
  spec: z.array(SpecReferenceSchema).min(1),
  fix: FixSchema,
});
export type CheckDefinition = z.infer<typeof CheckDefinitionSchema>;

/**
 * A gate is a list of alternatives: at least one listed check must pass.
 * A single-element gate is a hard requirement.
 */
export const LevelGateSchema = z.array(z.string().regex(CHECK_ID_PATTERN)).min(1);

export const LevelSchema = z.object({
  value: z.number().int().min(0).max(5),
  name: z.string().min(1),
  description: z.string().min(1),
  /** All gates must be satisfied. Level 0 has none: it is where a target lands otherwise. */
  gates: z.array(LevelGateSchema),
});
export type Level = z.infer<typeof LevelSchema>;

export const ProfileSchema = z.object({
  id: z.string().regex(/^[a-z][a-z0-9-]*$/),
  title: z.string().min(1),
  description: z.string().min(1),
  /** Dimensions whose checks apply. */
  dimensions: z.array(DimensionSchema).min(1),
  /** Platform requirements that are NOT satisfied in this profile; tagged checks drop out. */
  unsatisfied_requirements: z.array(RequirementSchema).default([]),
  /** Highest level this profile can reach. Levels above need commerce checks. */
  max_level: z.number().int().min(0).max(5).default(5),
});
export type Profile = z.infer<typeof ProfileSchema>;

export const CatalogSchema = z.object({
  /** Semantic version of the check catalog. Any change to checks or fixes bumps it. */
  version: z.string().regex(/^\d+\.\d+\.\d+$/),
  /** Semantic version of the scoring rules (weights, levels). Versioned apart from evidence. */
  scoring_version: z.string().regex(/^\d+\.\d+\.\d+$/),
  groups: z.array(GroupSchema).min(1),
  checks: z.array(CheckDefinitionSchema).min(1),
  levels: z.array(LevelSchema).min(1),
  profiles: z.array(ProfileSchema).min(1),
});
export type Catalog = z.infer<typeof CatalogSchema>;

/**
 * Structural validation beyond what the schema expresses: unique ids, resolvable
 * references, acyclic dependencies, one level per value.
 */
export function validateCatalogIntegrity(catalog: Catalog): string[] {
  const problems: string[] = [];
  const groupIds = new Set(catalog.groups.map((group) => group.id));
  const checkIds = new Map<string, CheckDefinition>();

  for (const check of catalog.checks) {
    if (checkIds.has(check.id)) {
      problems.push(`duplicate check id ${check.id}`);
    }
    checkIds.set(check.id, check);
    if (!groupIds.has(check.group)) {
      problems.push(`${check.id}: unknown group ${check.group}`);
    }
    if (!check.id.startsWith(check.group + '.')) {
      problems.push(`${check.id}: id does not start with its group ${check.group}`);
    }
  }

  for (const check of catalog.checks) {
    for (const dependency of check.depends_on) {
      if (!checkIds.has(dependency)) {
        problems.push(`${check.id}: depends on unknown check ${dependency}`);
      }
      if (dependency === check.id) {
        problems.push(`${check.id}: depends on itself`);
      }
    }
  }

  const visiting = new Set<string>();
  const visited = new Set<string>();
  const visit = (id: string, trail: string[]): void => {
    if (visited.has(id)) return;
    if (visiting.has(id)) {
      problems.push(`dependency cycle: ${[...trail, id].join(' -> ')}`);
      return;
    }
    visiting.add(id);
    for (const dependency of checkIds.get(id)?.depends_on ?? []) {
      visit(dependency, [...trail, id]);
    }
    visiting.delete(id);
    visited.add(id);
  };
  for (const id of checkIds.keys()) visit(id, []);

  const levelValues = new Set<number>();
  for (const level of catalog.levels) {
    if (levelValues.has(level.value)) {
      problems.push(`duplicate level value ${level.value}`);
    }
    levelValues.add(level.value);
    for (const gate of level.gates) {
      for (const id of gate) {
        if (!checkIds.has(id)) {
          problems.push(`level ${level.value}: gate references unknown check ${id}`);
        }
      }
    }
  }
  for (let value = 0; value <= 5; value += 1) {
    if (!levelValues.has(value)) problems.push(`missing level ${value}`);
  }

  const profileIds = new Set<string>();
  for (const profile of catalog.profiles) {
    if (profileIds.has(profile.id)) problems.push(`duplicate profile id ${profile.id}`);
    profileIds.add(profile.id);
  }

  return problems;
}
