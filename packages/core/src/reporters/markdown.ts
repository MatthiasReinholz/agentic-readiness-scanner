import type { ScanResult } from '@agentic-readiness/catalog';

import {
  countVerdicts,
  failedResults,
  groupResults,
  nextGateSentence,
  verdictSymbol,
} from './shared.js';

/**
 * The Markdown report is written for a coding agent or a ticket: level first, the next
 * gate in one sentence, one line per check, and the fix under every failed check.
 */
export function renderMarkdown(result: ScanResult): string {
  const lines: string[] = [];
  const counts = countVerdicts(result);
  lines.push(`# Agentic readiness report for ${result.target.url}`);
  lines.push('');
  lines.push(`**Level ${result.level.value}: ${result.level.name}.** ${nextGateSentence(result)}`);
  lines.push('');
  lines.push(`- Ingestion score: ${result.scores.ingestion}/100`);
  lines.push(
    `- Commerce score: ${result.scores.commerce === null ? 'not applicable' : `${result.scores.commerce}/100`}`,
  );
  lines.push(`- Platform: ${result.target.platform}, profile: ${result.target.profile}`);
  lines.push(
    `- Checks: ${counts.pass} pass, ${counts.warn} warn, ${counts.fail} fail, ${counts.skip} skipped`,
  );
  lines.push(
    `- Scanned ${result.scanned_at} with ${result.requests} request(s) in ${result.duration_ms} ms`,
  );
  lines.push(
    `- Catalog ${result.catalog_version}, scoring ${result.scoring_version}, scanner ${result.scanner_version}`,
  );
  lines.push('');
  if (result.scores.commerce !== null) {
    lines.push(
      '> A high commerce score means the public surface is in order. It does not mean a channel approved the products or that a checkout works.',
    );
    lines.push('');
  }
  for (const group of groupResults(result)) {
    lines.push(`## ${group.id}. ${group.title}`);
    lines.push('');
    for (const item of group.results) {
      const detail = item.message ? ` — ${item.message}` : '';
      const skip =
        item.verdict === 'skip' && item.skip_reason
          ? ` (${item.skip_reason.replace(/_/g, ' ')})`
          : '';
      lines.push(`- **${verdictSymbol(item.verdict)}** ${item.id} ${item.title}${skip}${detail}`);
    }
    lines.push('');
  }
  const failed = failedResults(result);
  if (failed.length > 0) {
    lines.push('## Fixes');
    lines.push('');
    for (const item of failed) {
      lines.push(`### ${item.id} ${item.title} (${verdictSymbol(item.verdict)})`);
      lines.push('');
      if (item.fix) {
        lines.push(item.fix.summary);
        lines.push('');
        if (item.fix.snippet) {
          lines.push('```' + (item.fix.snippet_language ?? ''));
          lines.push(item.fix.snippet);
          lines.push('```');
          lines.push('');
        }
        lines.push('<details><summary>Prompt for a coding agent</summary>');
        lines.push('');
        lines.push(item.fix.agent_prompt);
        lines.push('');
        lines.push('</details>');
        lines.push('');
      }
      lines.push('<details><summary>Evidence</summary>');
      lines.push('');
      lines.push('```json');
      lines.push(JSON.stringify(item.evidence, null, 2));
      lines.push('```');
      lines.push('');
      lines.push('</details>');
      lines.push('');
    }
  }
  if (result.warnings.length > 0) {
    lines.push('## Scan warnings');
    lines.push('');
    for (const warning of result.warnings) lines.push(`- ${warning}`);
    lines.push('');
  }
  return lines.join('\n');
}
