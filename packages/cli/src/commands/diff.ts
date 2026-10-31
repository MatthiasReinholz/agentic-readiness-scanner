import { readFileSync } from 'node:fs';

import { ScanResultSchema } from '@agentic-readiness/catalog';
import { describeDiff, diffSnapshots, snapshotOf } from '@agentic-readiness/core';

import type { DiffArguments } from '../args.js';

/**
 * Compares two saved JSON reports of the same target: what changed in level, scores and
 * per check. Exit code 0 means no change, 3 means something changed, so a pipeline can
 * fail a build when readiness regressed between two scans.
 */
export function runDiff(
  args: DiffArguments,
  stdout: (text: string) => void,
  stderr: (text: string) => void,
): number {
  const [before, after] = [args.before, args.after].map((path) => {
    const parsed = ScanResultSchema.safeParse(JSON.parse(readFileSync(path, 'utf8')));
    if (!parsed.success) throw new Error(`${path} is not a scan result: ${parsed.error.message}`);
    return parsed.data;
  });
  if (!before || !after) return 1;
  if (before.target.url !== after.target.url) {
    stderr(`Comparing different targets: ${before.target.url} and ${after.target.url}\n`);
  }
  const diff = diffSnapshots(snapshotOf(before), snapshotOf(after));
  if (args.format === 'json') {
    stdout(
      `${JSON.stringify(
        {
          target: after.target.url,
          before: { scanned_at: before.scanned_at, catalog_version: before.catalog_version },
          after: { scanned_at: after.scanned_at, catalog_version: after.catalog_version },
          ...diff,
        },
        null,
        2,
      )}\n`,
    );
  } else {
    const lines = describeDiff(diff);
    const header = `${after.target.url}: ${before.scanned_at} → ${after.scanned_at}${before.catalog_version !== after.catalog_version ? ` (catalog ${before.catalog_version} → ${after.catalog_version})` : ''}`;
    stdout(
      `${header}\n${lines.length > 0 ? lines.map((line) => `- ${line}`).join('\n') : 'No change.'}\n`,
    );
  }
  return diff.changed ? 3 : 0;
}
