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

/**
 * Crawler registry (decision 0020): every robots.txt product token the access checks
 * evaluate, documented by its operator. The checks, the fixes, the knowledge base and the
 * generated docs all read the crawler lists from here, so adding or reclassifying a crawler
 * is one data change.
 *
 * `kind` says how the client reaches a site: a crawler fetches on its own schedule; a
 * fetcher fetches one page because a person or an agent asked right now; an agent drives a
 * browser for a person; a token is a robots.txt control that makes no requests of its own
 * (Google-Extended governs what Googlebot already fetched).
 */
export const CrawlerKindSchema = z.enum(['crawler', 'fetcher', 'agent', 'token']);
export type CrawlerKind = z.infer<typeof CrawlerKindSchema>;

/**
 * What the operator documents the content is used for. `search`: an index that search
 * results or AI answers draw on. `answers`: fetched live to answer a request. `actions`: a
 * browser that acts for a person. `training`: training AI models.
 */
export const CrawlerPurposeSchema = z.enum(['training', 'search', 'answers', 'actions']);
export type CrawlerPurpose = z.infer<typeof CrawlerPurposeSchema>;

/**
 * How much blocking the token costs, for the clients whose purposes are search, answers or
 * actions. `core`: the two indexes most AI answers draw on (Google and Bing). `assistant`:
 * the operator's own index or fetcher for a general-purpose assistant offered worldwide.
 * `other`: a regional search engine, a developer API or a crawl service.
 */
export const CrawlerTierSchema = z.enum(['core', 'assistant', 'other']);
export type CrawlerTier = z.infer<typeof CrawlerTierSchema>;

/** What the operator documents about robots.txt: obeyed, may be ignored, or nothing said. */
export const RobotsBehaviourSchema = z.enum(['honours', 'may-ignore', 'not-stated']);
export type RobotsBehaviour = z.infer<typeof RobotsBehaviourSchema>;

/** RFC 9309 section 2.2.1: a product token is letters, underscores and hyphens (digits allowed here). */
const PRODUCT_TOKEN = /^[A-Za-z0-9_-]+$/;
const HTTPS_URL = z.url({ protocol: /^https$/ });

export const CrawlerSchema = z.object({
  /** The robots.txt product token, spelled as the operator documents it. */
  token: z.string().regex(PRODUCT_TOKEN),
  operator: z.string().min(1),
  kind: CrawlerKindSchema,
  purposes: z.array(CrawlerPurposeSchema).min(1),
  /** Required unless the only purpose is training. */
  tier: CrawlerTierSchema.optional(),
  /** What loses the site when the token is disallowed, in one phrase for reports. */
  feeds: z.string().min(1),
  robots: RobotsBehaviourSchema,
  /** The token whose group applies, by the operator's documentation, when robots.txt names none. */
  follows: z.string().regex(PRODUCT_TOKEN).optional(),
  /** The operator's published IP ranges, for owners who verify traffic in their logs. */
  ip_ranges: HTTPS_URL.optional(),
  /** The Signature-Agent of its Web Bot Auth signatures, when the operator documents one. */
  signature_agent: HTTPS_URL.optional(),
  /** True or false only when the operator documents it. */
  renders_javascript: z.boolean().optional(),
  /** The operator's own documentation of the token. */
  docs: HTTPS_URL,
  /** Further public sources for a statement in `feeds` or `note`. */
  see_also: z.array(HTTPS_URL).default([]),
  /** Last day the entry was checked against the operator's documentation. */
  verified: z.iso.date(),
  note: z.string().min(1).optional(),
});
export type Crawler = z.infer<typeof CrawlerSchema>;

/**
 * A token robots.txt files still name although its operator documents it no longer, or
 * never did: renamed, or found only in third-party block lists. A group for it reaches none
 * of the operator's current clients.
 */
export const LegacyTokenSchema = z.object({
  token: z.string().regex(PRODUCT_TOKEN),
  operator: z.string().min(1),
  status: z.enum(['renamed', 'undocumented']),
  /** The operator's current tokens, from `tokens`. Empty when the operator runs no crawler. */
  replaced_by: z.array(z.string().regex(PRODUCT_TOKEN)),
  /** The operator's documentation listing its current tokens (or saying it has none). */
  docs: HTTPS_URL,
  verified: z.iso.date(),
  note: z.string().min(1),
});
export type LegacyToken = z.infer<typeof LegacyTokenSchema>;

/**
 * An assistant or agent that reaches sites without a robots.txt token of its own: what a
 * site owner can know about it. `signature`: Web Bot Auth signatures; `own-browser`: it runs
 * in the person's own browser and looks like them; `none`: the operator documents nothing.
 */
export const AgentIdentitySchema = z.object({
  id: z.string().regex(/^[a-z][a-z0-9-]*$/),
  name: z.string().min(1),
  operator: z.string().min(1),
  identifies_by: z.enum(['signature', 'own-browser', 'none']),
  signature_agent: HTTPS_URL.optional(),
  docs: HTTPS_URL,
  verified: z.iso.date(),
  note: z.string().min(1),
});
export type AgentIdentity = z.infer<typeof AgentIdentitySchema>;

/**
 * A CDN or bot manager the scanner can recognise in front of a site, and where its owner
 * sets the rules for AI crawlers and agents. Edge rules match user agents, so they can
 * refuse GPTBot or ChatGPT-User while robots.txt allows them and an honest scan gets in.
 */
export const BotManagerSchema = z.object({
  id: z.string().regex(/^[a-z][a-z0-9-]*$/),
  name: z.string().min(1),
  /** Where the owner sets the AI crawler rules, phrased to follow "check". */
  ai_setting: z.string().min(1),
  /** What the vendor documents about its default or about signed agents, one sentence. */
  note: z.string().min(1),
  docs: HTTPS_URL,
  verified: z.iso.date(),
});
export type BotManager = z.infer<typeof BotManagerSchema>;

export const CrawlerRegistrySchema = z.object({
  tokens: z.array(CrawlerSchema).min(1),
  legacy: z.array(LegacyTokenSchema).default([]),
  agents: z.array(AgentIdentitySchema).default([]),
  bot_managers: z.array(BotManagerSchema).default([]),
});
export type CrawlerRegistry = z.infer<typeof CrawlerRegistrySchema>;

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
  /**
   * True when a warning on this check still satisfies a level gate and lifts its ceiling:
   * the warning is about stated intent or a minor gap, not about whether agents can reach
   * the site (robots.txt missing means "allow all"; one minor crawler blocked).
   */
  warn_meets_gate: z.boolean().default(false),
  /**
   * A technology check: it records how the store is built on its platform (the kind of
   * theme, a headless front end, the cart and checkout pages), never whether that is good.
   * Always weight info and bound to one platform. Reports list its facts (the
   * `evidence.facts` of the result, see TechnologyFact) next to the platform.
   */
  technology: z.boolean().default(false),
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
  /** The crawler registry the access checks evaluate robots.txt against (decision 0020). */
  crawlers: CrawlerRegistrySchema,
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
    if (check.technology) {
      if (check.weight !== 'info')
        problems.push(`${check.id}: technology checks are never scored (weight info)`);
      if (!check.requires.some((requirement) => requirement !== 'products'))
        problems.push(`${check.id}: a technology check is bound to one platform`);
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

  problems.push(...validateCrawlerRegistry(catalog.crawlers));
  return problems;
}

/**
 * The registry's own rules: tokens unique without regard to case (robots.txt matching is
 * case-insensitive), references that resolve, and a tier wherever blocking can cost
 * visibility in answers.
 */
export function validateCrawlerRegistry(registry: CrawlerRegistry): string[] {
  const problems: string[] = [];
  const seen = new Set<string>();
  const known = new Set(registry.tokens.map((crawler) => crawler.token.toLowerCase()));
  for (const entry of [...registry.tokens, ...registry.legacy]) {
    const key = entry.token.toLowerCase();
    if (seen.has(key)) problems.push(`crawlers: duplicate token ${entry.token}`);
    seen.add(key);
  }
  for (const crawler of registry.tokens) {
    const answers = crawler.purposes.some((purpose) => purpose !== 'training');
    if (answers && !crawler.tier)
      problems.push(`crawlers: ${crawler.token} serves search or answers but has no tier`);
    if (!answers && crawler.tier)
      problems.push(`crawlers: ${crawler.token} is training-only and takes no tier`);
    if (crawler.tier === 'core' && !crawler.purposes.includes('search'))
      problems.push(`crawlers: ${crawler.token} is core but builds no search index`);
    if (crawler.follows && !known.has(crawler.follows.toLowerCase()))
      problems.push(`crawlers: ${crawler.token} follows unknown token ${crawler.follows}`);
    if (crawler.kind === 'token' && (crawler.ip_ranges || crawler.signature_agent))
      problems.push(
        `crawlers: ${crawler.token} makes no requests, so it has no IP ranges or signatures`,
      );
    if (new Set(crawler.purposes).size !== crawler.purposes.length)
      problems.push(`crawlers: ${crawler.token} repeats a purpose`);
  }
  for (const legacy of registry.legacy) {
    for (const token of legacy.replaced_by)
      if (!known.has(token.toLowerCase()))
        problems.push(`crawlers: legacy ${legacy.token} is replaced by unknown token ${token}`);
    if (legacy.status === 'renamed' && legacy.replaced_by.length !== 1)
      problems.push(`crawlers: renamed token ${legacy.token} needs exactly one replacement`);
  }
  const ids = new Set<string>();
  for (const entry of [...registry.agents, ...registry.bot_managers]) {
    if (ids.has(entry.id)) problems.push(`crawlers: duplicate id ${entry.id}`);
    ids.add(entry.id);
  }
  for (const agent of registry.agents)
    if ((agent.identifies_by === 'signature') !== (agent.signature_agent !== undefined))
      problems.push(`crawlers: agent ${agent.id} needs a signature_agent exactly when it signs`);
  return problems;
}
