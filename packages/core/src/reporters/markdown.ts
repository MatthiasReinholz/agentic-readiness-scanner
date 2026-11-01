import {
  AGENT_WORKING_RULES,
  getCheck,
  type CheckResult,
  type ScanResult,
} from '@agentic-readiness/catalog';

import { scoreGroup } from '../scoring.js';
import { countSkips, prioritize, TIER_LABEL, type Priority } from './priorities.js';
import {
  countVerdicts,
  groupResults,
  nextGateSentence,
  scopeLines,
  verdictSymbol,
} from './shared.js';

/**
 * The Markdown report is written for a coding agent or a ticket: level first, the next
 * gate in one sentence, what to fix first, one line per check, and the fix under every
 * open finding. The working rules for coding agents appear once at the end rather than
 * inside every fix, so the document stays readable; the self-contained brief per finding
 * is available from the HTML report and the MCP get_fix tool.
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

/** The tags shown after a finding: tier, the level it unlocks, whether the fix is mechanical. */
export function priorityTags(priority: Priority): string[] {
  const tags = [TIER_LABEL[priority.tier]];
  if (priority.unlocks !== null) tags.push(`unlocks Level ${priority.unlocks}`);
  if (priority.mechanical) tags.push('mechanical fix');
  return tags;
}

function priorityItem(priority: Priority, index: number | null): string[] {
  const item = priority.result;
  const lead = index === null ? '-' : `${index}.`;
  const indent = index === null ? '  ' : '   ';
  const lines = [`${lead} **${item.id} ${item.title}** — ${priorityTags(priority).join(' · ')}`];
  if (item.message) lines.push(`${indent}Finding: ${item.message}.`);
  if (item.fix) lines.push(`${indent}Fix: ${item.fix.summary}`);
  return lines;
}

function compactItem(priority: Priority): string {
  const item = priority.result;
  const tags = priorityTags(priority).slice(1);
  const suffix = tags.length > 0 ? ` (${tags.join(', ')})` : '';
  return `- **${item.id} ${item.title}**${suffix}${item.message ? ` — ${item.message}` : ''}`;
}

function verdictLine(item: CheckResult): string {
  const detail = item.message ? ` — ${item.message}` : '';
  const skip =
    item.verdict === 'skip' && item.skip_reason ? ` (${item.skip_reason.replace(/_/g, ' ')})` : '';
  return `- **${verdictSymbol(item.verdict)}** ${item.id} ${item.title}${skip}${detail}`;
}

function fixSection(priority: Priority): string[] {
  const item = priority.result;
  const lines: string[] = [];
  lines.push(
    `### ${item.id} ${item.title} (${[verdictSymbol(item.verdict), ...priorityTags(priority)].join(' · ')})`,
  );
  lines.push('');
  if (item.message) {
    lines.push(`Finding: ${item.message}.`);
    lines.push('');
  }
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
    lines.push(`**Task for a coding agent.** ${item.fix.agent_prompt}`);
    lines.push('');
    const definition = getCheck(item.id);
    if (definition) {
      lines.push(`What the check looks for: ${definition.question} ${definition.method}`);
      lines.push('');
      lines.push('Specifications:');
      lines.push('');
      for (const ref of definition.spec) lines.push(`- ${ref.title}: ${ref.url}`);
      lines.push('');
    }
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
  return lines;
}

export function renderMarkdown(result: ScanResult, options: MarkdownReportOptions = {}): string {
  const lines: string[] = [];
  const counts = countVerdicts(result);
  const skips = countSkips(result);
  const priorities = prioritize(result);
  const open = [
    ...priorities.first,
    ...priorities.next,
    ...priorities.optional,
    ...priorities.informational,
  ];
  lines.push(`# Agentic readiness report for ${result.target.url}`);
  lines.push('');
  lines.push(`**Level ${result.level.value}: ${result.level.name}.** ${nextGateSentence(result)}`);
  lines.push('');
  lines.push(`- Ingestion score: ${result.scores.ingestion}/100`);
  lines.push(
    `- Commerce score: ${result.scores.commerce === null ? 'not applicable' : `${result.scores.commerce}/100`}`,
  );
  lines.push(`- Platform: ${result.target.platform}, profile: ${result.target.profile}`);
  const skipText = [
    skips.not_applicable > 0 ? `${skips.not_applicable} did not apply` : '',
    skips.unanswered > 0 ? `${skips.unanswered} could not run` : '',
  ].filter(Boolean);
  lines.push(
    `- Checks: ${[`${counts.pass} pass`, `${counts.warn} warn`, `${counts.fail} fail`, ...skipText].join(' · ')}`,
  );
  if (open.length > 0) {
    const tierCounts = (['blocking', 'expected', 'nice_to_have', 'informational'] as const)
      .filter((tier) => priorities.counts[tier] > 0)
      .map((tier) => `${priorities.counts[tier]} ${TIER_LABEL[tier]}`);
    lines.push(`- Open findings: ${tierCounts.join(' · ')}`);
  }
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
  if (open.length === 0) {
    lines.push('Nothing is open: every check that applied passed.');
    lines.push('');
  }
  if (priorities.first.length > 0) {
    lines.push('## Fix first');
    lines.push('');
    lines.push(
      'What stands between the store and the next level, then everything else that blocks agents.',
    );
    lines.push('');
    priorities.first.forEach((priority, index) => lines.push(...priorityItem(priority, index + 1)));
    lines.push('');
  }
  if (priorities.next.length > 0) {
    lines.push('## Fix next');
    lines.push('');
    lines.push('Expected by the channels and crawlers behind AI answers; each costs points.');
    lines.push('');
    priorities.next.forEach((priority, index) => lines.push(...priorityItem(priority, index + 1)));
    lines.push('');
  }
  if (priorities.optional.length > 0) {
    lines.push('## Nice to have');
    lines.push('');
    lines.push(
      'Conventions and optional protocols with no documented consumer that requires them. Low weight; adopt them when they fit.',
    );
    lines.push('');
    for (const priority of priorities.optional) lines.push(compactItem(priority));
    lines.push('');
  }
  if (priorities.informational.length > 0) {
    lines.push('## Informational');
    lines.push('');
    lines.push('Reported, never scored.');
    lines.push('');
    for (const priority of priorities.informational) lines.push(compactItem(priority));
    lines.push('');
  }
  lines.push('## Results by section');
  lines.push('');
  for (const group of groupResults(result)) {
    const score = scoreGroup(result.results, group.id);
    lines.push(
      `### ${group.id}. ${group.title} (${score === null ? 'not applicable' : `${score}/100`})`,
    );
    lines.push('');
    for (const item of group.results) lines.push(verdictLine(item));
    lines.push('');
  }
  if (open.length > 0) {
    lines.push('## Fixes');
    lines.push('');
    lines.push(
      'In the order above. Each fix names the task for a coding agent; the working rules for every task are at the end of this report.',
    );
    lines.push('');
    for (const priority of open) lines.push(...fixSection(priority));
    lines.push('## Working rules for coding agents');
    lines.push('');
    lines.push(
      `These findings come from the Agentic Readiness Scanner (https://github.com/MatthiasReinholz/agentic-readiness-scanner), an open-source tool that checks whether AI shopping agents and crawlers can find, read, trust and buy from a web store using public signals only. A scan of ${result.target.url} on ${result.scanned_at.slice(0, 10)}${result.target.platform === 'unknown' ? '' : ` (detected platform: ${result.target.platform})`} produced them.${options.reportUrl ? ` Full report: ${options.reportUrl}` : ''}`,
    );
    lines.push('');
    AGENT_WORKING_RULES.forEach((rule, index) => lines.push(`${index + 1}. ${rule}`));
    lines.push('');
  }
  lines.push('## What this scan did and did not do');
  lines.push('');
  for (const line of scopeLines(result)) lines.push(`- ${line}`);
  lines.push('');
  if (result.warnings.length > 0) {
    lines.push('## Scan warnings');
    lines.push('');
    for (const warning of result.warnings) lines.push(`- ${warning}`);
    lines.push('');
  }
  return lines.join('\n');
}
