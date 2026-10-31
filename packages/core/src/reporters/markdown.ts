import { composeAgentPrompt, getCheck, type ScanResult } from '@agentic-readiness/catalog';

import { scoreGroup } from '../scoring.js';
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
/** A fence longer than any backtick run inside the content, so target text cannot close it. */
export function fenceFor(content: string): string {
  const longest = Math.max(0, ...(content.match(/`+/g) ?? []).map((run) => run.length));
  return '`'.repeat(Math.max(3, longest + 1));
}

export interface MarkdownReportOptions {
  /** Canonical URL of this report, included in agent prompts. */
  reportUrl?: string;
}

export function renderMarkdown(result: ScanResult, options: MarkdownReportOptions = {}): string {
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
    const score = scoreGroup(result.results, group.id);
    lines.push(
      `## ${group.id}. ${group.title} (${score === null ? 'not applicable' : `${score}/100`})`,
    );
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
          const fence = fenceFor(item.fix.snippet);
          lines.push(fence + (item.fix.snippet_language ?? ''));
          lines.push(item.fix.snippet);
          lines.push(fence);
          lines.push('');
        }
        const definition = getCheck(item.id);
        lines.push('<details><summary>Brief for a coding agent</summary>');
        lines.push('');
        lines.push(
          definition
            ? composeAgentPrompt(definition, {
                targetUrl: result.target.url,
                scannedAt: result.scanned_at,
                platform: result.target.platform,
                verdict: item.verdict,
                ...(item.message ? { message: item.message } : {}),
                ...(options.reportUrl ? { reportUrl: options.reportUrl } : {}),
              })
            : item.fix.agent_prompt,
        );
        lines.push('');
        lines.push('</details>');
        lines.push('');
      }
      lines.push('<details><summary>Evidence</summary>');
      lines.push('');
      const evidence = JSON.stringify(item.evidence, null, 2);
      const evidenceFence = fenceFor(evidence);
      lines.push(`${evidenceFence}json`);
      lines.push(evidence);
      lines.push(evidenceFence);
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
