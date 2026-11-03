/**
 * Loads and validates the catalog from `data/` and `fixes/`.
 * Used by the build and docs scripts and by tests; the published package ships the
 * generated, pre-validated catalog instead so runtime consumers never touch the filesystem.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { z } from 'zod';

import { parseFixMarkdown } from './fixes.js';
import { articleLinks, parseKnowledgeMarkdown, type KnowledgeArticle } from './knowledge.js';
import {
  CatalogSchema,
  CheckDefinitionSchema,
  GroupSchema,
  LawSchema,
  LevelSchema,
  ProfileSchema,
  validateCatalogIntegrity,
  type Catalog,
} from './schema.js';

const CheckSourceSchema = CheckDefinitionSchema.omit({ fix: true });
const MetaSchema = z.object({
  version: z.string(),
  scoring_version: z.string(),
});

function readJson(path: string): unknown {
  return JSON.parse(readFileSync(path, 'utf8')) as unknown;
}

export class CatalogLoadError extends Error {
  constructor(public readonly problems: string[]) {
    super(`Catalog is invalid:\n- ${problems.join('\n- ')}`);
    this.name = 'CatalogLoadError';
  }
}

export function loadCatalogFromDisk(packageRoot: string): Catalog {
  const dataDir = join(packageRoot, 'data');
  const fixesDir = join(packageRoot, 'fixes');
  const problems: string[] = [];

  const meta = MetaSchema.parse(readJson(join(dataDir, 'meta.json')));
  const groups = z.array(GroupSchema).parse(readJson(join(dataDir, 'groups.json')));
  const levels = z.array(LevelSchema).parse(readJson(join(dataDir, 'levels.json')));
  const profiles = z.array(ProfileSchema).parse(readJson(join(dataDir, 'profiles.json')));

  const fixFiles = new Set(readdirSync(fixesDir).filter((name) => name.endsWith('.md')));
  const readChecks = (dir: string) => {
    const found = [];
    const files = readdirSync(dir)
      .filter((name) => name.endsWith('.json'))
      .sort();
    for (const file of files) {
      const parsed = z.array(CheckSourceSchema).safeParse(readJson(join(dir, file)));
      if (!parsed.success) {
        problems.push(
          `${file}: ${parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ')}`,
        );
        continue;
      }
      for (const source of parsed.data) {
        const fixFile = `${source.id}.md`;
        if (!fixFiles.has(fixFile)) {
          problems.push(`${source.id}: missing fixes/${fixFile}`);
          continue;
        }
        fixFiles.delete(fixFile);
        try {
          const fix = parseFixMarkdown(readFileSync(join(fixesDir, fixFile), 'utf8'), fixFile);
          found.push({ ...source, fix });
        } catch (error) {
          problems.push(error instanceof Error ? error.message : String(error));
        }
      }
    }
    return found;
  };
  const checks = readChecks(join(dataDir, 'checks'));
  const legalDir = join(dataDir, 'legal');
  const legal = {
    groups: z.array(GroupSchema).parse(readJson(join(legalDir, 'groups.json'))),
    laws: z.array(LawSchema).parse(readJson(join(legalDir, 'laws.json'))),
    checks: readChecks(join(legalDir, 'checks')),
  };
  for (const orphan of fixFiles) {
    problems.push(`fixes/${orphan} has no matching check definition`);
  }

  const catalogParse = CatalogSchema.safeParse({
    ...meta,
    groups,
    checks,
    levels,
    profiles,
    legal,
  });
  if (!catalogParse.success) {
    problems.push(...catalogParse.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`));
    throw new CatalogLoadError(problems);
  }
  problems.push(...validateCatalogIntegrity(catalogParse.data));
  if (problems.length > 0) {
    throw new CatalogLoadError(problems);
  }
  return catalogParse.data;
}

/**
 * Loads `knowledge/`: one article per check, in catalog order, with unique slugs and
 * links that resolve to another article.
 */
export function loadKnowledgeFromDisk(packageRoot: string, catalog: Catalog): KnowledgeArticle[] {
  const dir = join(packageRoot, 'knowledge');
  const problems: string[] = [];
  const files = new Set(readdirSync(dir).filter((name) => name.endsWith('.md')));
  const articles: KnowledgeArticle[] = [];
  for (const check of [...catalog.checks, ...catalog.legal.checks]) {
    const file = `${check.id}.md`;
    if (!files.has(file)) {
      problems.push(`${check.id}: missing knowledge/${file}`);
      continue;
    }
    files.delete(file);
    try {
      articles.push(parseKnowledgeMarkdown(readFileSync(join(dir, file), 'utf8'), file));
    } catch (error) {
      problems.push(error instanceof Error ? error.message : String(error));
    }
  }
  for (const orphan of files) problems.push(`knowledge/${orphan} has no matching check definition`);
  const slugs = new Map<string, string>();
  for (const article of articles) {
    const taken = slugs.get(article.slug);
    if (taken) problems.push(`${article.id}: slug ${article.slug} is already used by ${taken}`);
    slugs.set(article.slug, article.id);
  }
  for (const article of articles)
    for (const link of articleLinks(article))
      if (!slugs.has(link))
        problems.push(`${article.id}: link to unknown article /knowledge/${link}`);
  if (problems.length > 0) throw new CatalogLoadError(problems);
  return articles;
}
