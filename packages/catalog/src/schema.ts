/**
 * Catalog schema.
 *
 * The catalog is data, not code: check definitions, groups, levels, profiles and fixes
 * live in JSON and Markdown under `data/` and `fixes/`. This schema is the contract that
 * every consumer (the engine, the docs generator, the MCP tools and anyone reading the
 * published catalog.json) relies on. Changing it is a catalog release.
 */
import { z } from 'zod';

import { KNOWN_PLATFORMS } from './platform-ids.js';

/** A and B are the readiness dimensions; C is the legal-signals category. */
export const CHECK_ID_PATTERN = /^[ABC][1-6]\.\d{1,2}$/;
export const GROUP_ID_PATTERN = /^[ABC][1-6]$/;

/**
 * `ingestion` and `commerce` are scored and gate the level. `legal` is the legal-signals
 * category: reported on its own page, never scored, never part of the level.
 */
export const DimensionSchema = z.enum(['ingestion', 'commerce', 'legal']);
export type Dimension = z.infer<typeof DimensionSchema>;
/** The two scored dimensions. */
export type ScoredDimension = Exclude<Dimension, 'legal'>;

/**
 * Markets a store can sell to, as far as legal signals distinguish them. National and
 * state rules (Germany, California, Quebec) are law jurisdictions inside these markets.
 */
export const MarketSchema = z.enum([
  'EU',
  'UK',
  'CH',
  'US',
  'CA',
  'AU',
  'BR',
  'AR',
  'CL',
  'CO',
  'PE',
]);
export type Market = z.infer<typeof MarketSchema>;

/** A legal provision a legal-signals check relates to, with its official text. */
export const LawSchema = z.object({
  id: z.string().regex(/^[a-z]{2}(?:-[a-z]{2})?-[a-z0-9-]+$/),
  /** EU, a country code (DE, UK, BR) or a subdivision (US-CA, CA-QC). */
  jurisdiction: z.string().regex(/^[A-Z]{2}(?:-[A-Z]{2})?$/),
  /** The market whose stores the provision concerns. */
  market: MarketSchema,
  /** Short name with the provision: "Consumer Rights Directive, Art. 11a". */
  name: z.string().min(1),
  /** The instrument in full, with amendments where they matter. */
  instrument: z.string().min(1),
  /** The official text: EUR-Lex, legislation.gov.uk, fedlex, planalto and the like. */
  url: z.url({ protocol: /^https$/ }),
  /** First day the provision applies, when that is today or later than the catalog. */
  applies_from: z.iso.date().optional(),
  /** Last day the entry was checked against the official text and current reporting. */
  verified: z.iso.date(),
  /** One sentence on who it binds or what it requires, for the report. */
  note: z.string().min(1),
});
export type Law = z.infer<typeof LawSchema>;

/** 1 = nice to have, 2 = expected, 3 = blocking for agents, "info" = reported, never scored. */
export const WeightSchema = z.union([z.literal(1), z.literal(2), z.literal(3), z.literal('info')]);
export type Weight = z.infer<typeof WeightSchema>;

export const VerdictSchema = z.enum(['pass', 'warn', 'fail', 'skip']);
export type Verdict = z.infer<typeof VerdictSchema>;

/**
 * What a target must offer for a check to apply: a platform id (the scan recognised that
 * platform; `wordpress` is also met by WooCommerce, which runs on it) or `products`
 * (product pages were found to sample). A profile lists the requirements it can never
 * satisfy; the runner evaluates the rest per target.
 */
export const RequirementSchema = z.enum([...KNOWN_PLATFORMS, 'products']);
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

/** Platforms a fix can carry advice for. A wordpress note also applies to WooCommerce. */
export const FixPlatformSchema = z.enum(KNOWN_PLATFORMS);
export type FixPlatform = z.infer<typeof FixPlatformSchema>;

export const PlatformNoteSchema = z.object({
  platform: FixPlatformSchema,
  /** Advice that holds only on this platform, in one or two sentences. */
  text: z.string().min(1),
});
export type PlatformNote = z.infer<typeof PlatformNoteSchema>;

/**
 * A fix as the catalog holds it: the platform-neutral fix plus advice per platform. A
 * result carries the plain Fix, with the notes for the detected platform folded into its
 * agent prompt (see fixForPlatform), so the published result contract is unchanged.
 */
export const CatalogFixSchema = FixSchema.extend({
  platform_notes: z.array(PlatformNoteSchema).default([]),
});
export type CatalogFix = z.infer<typeof CatalogFixSchema>;

export const GroupSchema = z.object({
  id: z.string().regex(GROUP_ID_PATTERN),
  /** The technical name, for experts and the knowledge base: "Discoverability". */
  title: z.string().min(1),
  /** The short plain name every reader understands: "Findable". Required for readiness groups. */
  label: z.string().min(1).optional(),
  /** The plain question the section answers: "Can AI find your site and products?" */
  question: z.string().min(1).optional(),
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
  /** Legal-signals checks: the law registry entries the check relates to. */
  laws: z.array(z.string()).default([]),
  /**
   * Legal-signals checks: the markets the check is about. Empty means any market; otherwise
   * the check only runs when the store appears to sell to one of them.
   */
  markets: z.array(MarketSchema).default([]),
  fix: CatalogFixSchema,
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

/**
 * A score ceiling: while any of its gates is unmet, a dimension cannot score above the
 * value given for it. A weighted average rewards many small things done well; a ceiling
 * ties the score to the capability that decides whether agents can use the store at all,
 * so a store agents cannot reach or buy from never reads 90.
 */
export const CeilingSchema = z.object({
  id: z.string().regex(/^[a-z][a-z0-9-]*$/),
  /** The condition, phrased to follow "Capped at 60 while …". */
  reason: z.string().min(1),
  /** Gates in the level sense: each needs one passing alternative. */
  gates: z.array(LevelGateSchema).min(1),
  values: z
    .object({
      ingestion: z.number().int().min(0).max(99).optional(),
      commerce: z.number().int().min(0).max(99).optional(),
    })
    .refine((values) => values.ingestion !== undefined || values.commerce !== undefined, {
      message: 'a ceiling caps at least one dimension',
    }),
});
export type Ceiling = z.infer<typeof CeilingSchema>;

export const ProfileSchema = z.object({
  id: z.string().regex(/^[a-z][a-z0-9-]*$/),
  title: z.string().min(1),
  description: z.string().min(1),
  /** Dimensions whose checks apply. */
  dimensions: z.array(DimensionSchema).min(1),
  /** Platform requirements that are NOT satisfied in this profile; tagged checks drop out. */
  unsatisfied_requirements: z.array(RequirementSchema).default([]),
  /**
   * Checks that never apply to this profile although their requirements are met: a
   * content site is not asked for product URLs in its sitemap.
   */
  excluded_checks: z.array(z.string().regex(CHECK_ID_PATTERN)).default([]),
  /** Highest level this profile can reach. Levels above need commerce checks. */
  max_level: z.number().int().min(0).max(5).default(5),
});
export type Profile = z.infer<typeof ProfileSchema>;

/** What a reader sees for a scored dimension: a short name and the question it answers. */
export const DimensionCopySchema = z.object({
  id: z.enum(['ingestion', 'commerce']),
  /** The headline name: "Visible to AI". */
  label: z.string().min(1),
  /** The plain question the score answers: "Can AI find and read your site?" */
  question: z.string().min(1),
});
export type DimensionCopy = z.infer<typeof DimensionCopySchema>;

export const CatalogSchema = z.object({
  /** Semantic version of the check catalog. Any change to checks or fixes bumps it. */
  version: z.string().regex(/^\d+\.\d+\.\d+$/),
  /** Semantic version of the scoring rules (weights, levels). Versioned apart from evidence. */
  scoring_version: z.string().regex(/^\d+\.\d+\.\d+$/),
  /** Reader-facing names of the two scores; the result keys stay ingestion and commerce. */
  dimensions: z.array(DimensionCopySchema).length(2),
  groups: z.array(GroupSchema).min(1),
  checks: z.array(CheckDefinitionSchema).min(1),
  levels: z.array(LevelSchema).min(1),
  /** Score ceilings; empty means scores are the plain weighted ratio. */
  ceilings: z.array(CeilingSchema).default([]),
  profiles: z.array(ProfileSchema).min(1),
  /**
   * Legal signals: groups and checks of the `legal` dimension and the law registry they
   * cite. Kept apart from `groups` and `checks` so the readiness catalog, its scores, its
   * level and every surface built on it are untouched by them.
   */
  legal: z
    .object({
      groups: z.array(GroupSchema),
      checks: z.array(CheckDefinitionSchema),
      laws: z.array(LawSchema),
    })
    .default({ groups: [], checks: [], laws: [] }),
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

  const ceilingIds = new Set<string>();
  for (const ceiling of catalog.ceilings) {
    if (ceilingIds.has(ceiling.id)) problems.push(`duplicate ceiling id ${ceiling.id}`);
    ceilingIds.add(ceiling.id);
    for (const id of ceiling.gates.flat()) {
      if (!checkIds.has(id)) problems.push(`ceiling ${ceiling.id}: unknown check ${id}`);
    }
  }

  for (const group of catalog.groups) {
    if (group.dimension === 'legal')
      problems.push(`group ${group.id}: legal groups belong in legal.groups`);
    if (!group.label || !group.question)
      problems.push(`group ${group.id}: readiness groups need a label and a question`);
  }
  for (const id of ['ingestion', 'commerce'] as const) {
    if (!catalog.dimensions.some((dimension) => dimension.id === id))
      problems.push(`dimensions: missing ${id}`);
  }
  const legalGroups = new Map(catalog.legal.groups.map((group) => [group.id, group]));
  const lawIds = new Set<string>();
  for (const law of catalog.legal.laws) {
    if (lawIds.has(law.id)) problems.push(`duplicate law id ${law.id}`);
    lawIds.add(law.id);
  }
  for (const group of catalog.legal.groups) {
    if (group.dimension !== 'legal')
      problems.push(`legal group ${group.id}: dimension must be legal`);
    if (!group.id.startsWith('C')) problems.push(`legal group ${group.id}: id must start with C`);
  }
  const legalIds = new Set<string>();
  for (const check of catalog.legal.checks) {
    if (checkIds.has(check.id) || legalIds.has(check.id))
      problems.push(`duplicate check id ${check.id}`);
    legalIds.add(check.id);
    if (!legalGroups.has(check.group))
      problems.push(`${check.id}: unknown legal group ${check.group}`);
    if (!check.id.startsWith(check.group + '.')) {
      problems.push(`${check.id}: id does not start with its group ${check.group}`);
    }
    if (check.weight !== 'info')
      problems.push(`${check.id}: legal signals are never scored (weight info)`);
    if (check.laws.length === 0) problems.push(`${check.id}: cites no law`);
    for (const law of check.laws) {
      if (!lawIds.has(law)) problems.push(`${check.id}: cites unknown law ${law}`);
    }
    for (const dependency of check.depends_on) {
      if (!catalog.legal.checks.some((other) => other.id === dependency)) {
        problems.push(`${check.id}: depends on ${dependency}, which is not a legal check`);
      }
    }
  }
  for (const check of catalog.checks) {
    if (check.laws.length > 0 || check.markets.length > 0) {
      problems.push(`${check.id}: laws and markets belong to legal checks only`);
    }
  }

  const profileIds = new Set<string>();
  for (const profile of catalog.profiles) {
    if (profileIds.has(profile.id)) problems.push(`duplicate profile id ${profile.id}`);
    profileIds.add(profile.id);
    for (const id of profile.excluded_checks) {
      if (!checkIds.has(id) && !legalIds.has(id)) {
        problems.push(`profile ${profile.id}: excludes unknown check ${id}`);
      }
    }
  }

  return problems;
}
