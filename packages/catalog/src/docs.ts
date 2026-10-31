/**
 * Generates docs/checks.md at the repository root from the catalog.
 * CI fails when the committed file is stale (scripts/ci/check-docs-parity.sh).
 */
import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { loadCatalogFromDisk } from './load.js';
import type { Catalog, CheckDefinition } from './schema.js';

const packageRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const repoRoot = join(packageRoot, '..', '..');

function escapeCell(text: string): string {
  return text.replace(/\\/g, '\\\\').replace(/\|/g, '\\|').replace(/\n/g, ' ');
}

function weightLabel(check: CheckDefinition): string {
  return check.weight === 'info' ? 'info' : String(check.weight);
}

export function renderChecksDoc(catalog: Catalog): string {
  const lines: string[] = [];
  lines.push('# Check catalog');
  lines.push('');
  lines.push(
    `<!-- Generated from packages/catalog by \`pnpm docs:generate\`. Edit the data files, not this file. -->`,
  );
  lines.push('');
  lines.push(
    `Catalog version **${catalog.version}**, scoring version **${catalog.scoring_version}**.`,
  );
  lines.push('');
  lines.push(
    `${catalog.checks.length} checks in ${catalog.groups.length} groups. Each check answers one question, records the evidence that decided it, and ships with a fix. Weight 1 is nice to have, 2 is expected, 3 is blocking for agents; "info" checks are reported but never scored. Checks marked WC run only when WooCommerce is detected; checks marked products run only when product pages were found.`,
  );
  lines.push('');
  lines.push('## Levels');
  lines.push('');
  lines.push('| Level | Name | Gate |');
  lines.push('| --- | --- | --- |');
  for (const level of [...catalog.levels].sort((a, b) => a.value - b.value)) {
    const gate =
      level.gates.length === 0
        ? escapeCell(level.description)
        : level.gates.map((alternatives) => alternatives.join(' or ')).join(', ');
    lines.push(`| ${level.value} | ${escapeCell(level.name)} | ${gate} |`);
  }
  lines.push('');
  lines.push('## Profiles');
  lines.push('');
  lines.push('| Profile | Applies | Drops | Max level |');
  lines.push('| --- | --- | --- | --- |');
  for (const profile of catalog.profiles) {
    const dropped = catalog.checks
      .filter(
        (check) =>
          !profile.dimensions.includes(
            catalog.groups.find((group) => group.id === check.group)?.dimension ?? 'ingestion',
          ) || check.requires.some((req) => profile.unsatisfied_requirements.includes(req)),
      )
      .map((check) => check.id);
    const applies =
      dropped.length === 0
        ? `all ${catalog.checks.length}`
        : `${catalog.checks.length - dropped.length}`;
    lines.push(
      `| ${escapeCell(profile.title)} | ${applies} | ${dropped.length === 0 ? 'nothing' : dropped.length > 12 ? `${dropped.length} checks (all commerce groups)` : dropped.join(', ')} | ${profile.max_level} |`,
    );
  }
  lines.push('');
  for (const group of catalog.groups) {
    const checks = catalog.checks.filter((check) => check.group === group.id);
    lines.push(`## ${group.id}. ${group.title} (${group.dimension})`);
    lines.push('');
    lines.push(group.description);
    lines.push('');
    lines.push('| ID | Check | How it is tested | Weight | Depends on | Spec |');
    lines.push('| --- | --- | --- | --- | --- | --- |');
    for (const check of checks) {
      const tags = check.requires.map((requirement) =>
        requirement === 'woocommerce' ? 'WC' : requirement,
      );
      const wc = tags.length > 0 ? ` (${tags.join(', ')})` : '';
      const spec = check.spec.map((ref) => `[${escapeCell(ref.title)}](${ref.url})`).join(', ');
      lines.push(
        `| ${check.id} | ${escapeCell(check.title)}${wc} | ${escapeCell(check.method)} | ${weightLabel(check)} | ${check.depends_on.join(', ') || '–'} | ${spec} |`,
      );
    }
    lines.push('');
  }
  lines.push('## Fixes');
  lines.push('');
  lines.push(
    'Every check ships a fix in three forms: a sentence, a snippet or file when one applies, and a brief for a coding agent. Fixes marked **mechanical** are file, setting or markup changes that a tool or agent can apply from existing store data; the others need product knowledge or copy. The full text lives in `packages/catalog/fixes/<id>.md` and in the `fix` field of every failed check in a report.',
  );
  lines.push('');
  lines.push('| ID | Summary | Mechanical |');
  lines.push('| --- | --- | --- |');
  for (const check of catalog.checks) {
    lines.push(
      `| ${check.id} | ${escapeCell(check.fix.summary)} | ${check.fix.auto_fix ? 'yes' : '–'} |`,
    );
  }
  lines.push('');
  return lines.join('\n');
}

const catalog = loadCatalogFromDisk(packageRoot);
const output = join(repoRoot, 'docs', 'checks.md');
writeFileSync(output, renderChecksDoc(catalog));
console.log(`Wrote ${output}`);
