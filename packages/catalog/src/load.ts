/**
 * Loads and validates the catalog from `data/` and `fixes/`.
 * Used by the build and docs scripts and by tests; the published package ships the
 * generated, pre-validated catalog instead so runtime consumers never touch the filesystem.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { z } from 'zod';

import { parseFixMarkdown } from './fixes.js';
import {
  CatalogSchema,
  CheckDefinitionSchema,
  GroupSchema,
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
  const checks = [];
  const checkFiles = readdirSync(join(dataDir, 'checks'))
    .filter((name) => name.endsWith('.json'))
    .sort();

  for (const file of checkFiles) {
    const parsed = z.array(CheckSourceSchema).safeParse(readJson(join(dataDir, 'checks', file)));
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
        checks.push({ ...source, fix });
      } catch (error) {
        problems.push(error instanceof Error ? error.message : String(error));
      }
    }
  }
  for (const orphan of fixFiles) {
    problems.push(`fixes/${orphan} has no matching check definition`);
  }

  const catalogParse = CatalogSchema.safeParse({ ...meta, groups, checks, levels, profiles });
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
