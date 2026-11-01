import { writeFileSync } from 'node:fs';

import type { ScanResult } from '@agentic-readiness/catalog';
import {
  renderBadge,
  renderHtml,
  renderJson,
  renderMarkdown,
  scan,
  type ScanOptions,
} from '@agentic-readiness/core';
import { fixtureFetcher } from '@agentic-readiness/core/testing';

import type { OutputFormat, ScanArguments } from '../args.js';

export function render(result: ScanResult, format: OutputFormat): string {
  switch (format) {
    case 'json':
      return renderJson(result);
    case 'md':
      return renderMarkdown(result);
    case 'html':
      return renderHtml(result);
    case 'badge':
      return renderBadge(result);
  }
}

/**
 * The full reason a scan did not produce a report: the error's own message followed by
 * every cause down the chain, since the platform fetch keeps the useful part
 * (ECONNRESET, a TLS code) in `cause`.
 */
export function describeScanError(error: unknown): string {
  if (!(error instanceof Error)) return `scan failed: ${String(error)}`;
  const parts = [error.message || error.name];
  for (let cause = error.cause; cause !== undefined && cause !== null;) {
    if (cause instanceof Error) {
      const code = (cause as { code?: unknown }).code;
      parts.push(cause.message || (typeof code === 'string' ? code : cause.name));
      cause = cause.cause;
    } else {
      parts.push(typeof cause === 'string' ? cause : JSON.stringify(cause));
      break;
    }
  }
  return `scan failed: ${parts.join(': ')}`;
}

export async function runScan(
  args: ScanArguments,
  stdout: (text: string) => void,
  stderr: (text: string) => void,
): Promise<number> {
  const options: ScanOptions = {
    ...(args.fixture
      ? {
          fetcher: fixtureFetcher(
            args.fixture,
            args.budget !== undefined ? { budget: args.budget } : {},
          ),
        }
      : {}),
    ...(args.budget !== undefined ? { budget: args.budget } : {}),
    ...(args.sampleSize !== undefined ? { sampleSize: args.sampleSize } : {}),
    ...(args.timeoutMs !== undefined ? { timeoutMs: args.timeoutMs } : {}),
    ...(args.profile !== undefined ? { profile: args.profile } : {}),
  };
  let result: ScanResult;
  try {
    result = await scan(args.url, options);
  } catch (error) {
    stderr(`${describeScanError(error)}\n`);
    return 2;
  }
  const output = render(result, args.format);
  if (args.output) {
    writeFileSync(args.output, output);
    stderr(`Wrote ${args.output}\n`);
  } else {
    stdout(output);
  }
  return 0;
}
