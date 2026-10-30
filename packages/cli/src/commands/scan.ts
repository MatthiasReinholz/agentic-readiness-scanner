import { writeFileSync } from 'node:fs';

import type { ScanResult } from '@agentic-readiness/catalog';
import {
  renderBadge,
  renderHtml,
  renderJson,
  renderMarkdown,
  scan,
  TargetUnreachableError,
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
    if (error instanceof TargetUnreachableError) {
      stderr(`${error.message}\n`);
      return 2;
    }
    throw error;
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
