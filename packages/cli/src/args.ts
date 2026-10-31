import { parseArgs } from 'node:util';

import { catalog } from '@agentic-readiness/catalog';

export type OutputFormat = 'json' | 'md' | 'html' | 'badge';

export interface ScanArguments {
  command: 'scan';
  url: string;
  format: OutputFormat;
  profile?: string;
  budget?: number;
  sampleSize?: number;
  timeoutMs?: number;
  fixture?: string;
  output?: string;
}

export interface DiffArguments {
  command: 'diff';
  before: string;
  after: string;
  format: 'text' | 'json';
}

export interface SimpleArguments {
  command: 'mcp' | 'catalog' | 'help' | 'version';
}

export type CliArguments = ScanArguments | DiffArguments | SimpleArguments;

const PROFILE_IDS = catalog.profiles.map((profile) => profile.id);

export const USAGE = `agentic-readiness <command> [options]

Commands
  scan <url>         Scan a store and print the report
  diff <a> <b>       Compare two saved JSON reports (exit 3 when something changed)
  mcp                Run the MCP server over stdio
  catalog            Print the check catalog
  version            Print the scanner version
  help               Show this help

Scan options
  --format <fmt>     json | md | html | badge (default: md)
  --profile <id>     ${PROFILE_IDS.join(' | ')} (default: detected)
  --budget <n>       Maximum requests per scan (default: 40)
  --sample <n>       Product pages to sample (default: 2)
  --timeout <ms>     Per-request timeout in milliseconds (default: 10000)
  --fixture <dir>    Answer from a recorded fixture directory instead of the network
  --output <file>    Write the report to a file instead of stdout

Diff options
  --format <fmt>     text | json (default: text)
`;

function positiveInteger(name: string, value: string | undefined): number | undefined {
  if (value === undefined) return undefined;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0)
    throw new Error(`--${name} must be a positive integer`);
  return parsed;
}

export function parseCliArguments(argv: readonly string[]): CliArguments {
  const { values, positionals } = parseArgs({
    args: [...argv],
    allowPositionals: true,
    options: {
      format: { type: 'string', short: 'f' },
      profile: { type: 'string', short: 'p' },
      budget: { type: 'string' },
      sample: { type: 'string' },
      timeout: { type: 'string' },
      fixture: { type: 'string' },
      output: { type: 'string', short: 'o' },
      help: { type: 'boolean', short: 'h' },
      version: { type: 'boolean', short: 'v' },
    },
  });
  if (values.help) return { command: 'help' };
  if (values.version) return { command: 'version' };
  const [command, url] = positionals;
  switch (command) {
    case 'scan': {
      if (!url) throw new Error('scan needs a URL\n\n' + USAGE);
      const format = values.format ?? 'md';
      if (!['json', 'md', 'html', 'badge'].includes(format))
        throw new Error(`unknown format ${format}`);
      // Rejected here so a typo is a usage error with exit code 1, not a crash mid-scan.
      if (values.profile !== undefined && !PROFILE_IDS.includes(values.profile))
        throw new Error(`unknown profile ${values.profile} (expected ${PROFILE_IDS.join(', ')})`);
      const budget = positiveInteger('budget', values.budget);
      const sampleSize = positiveInteger('sample', values.sample);
      const timeoutMs = positiveInteger('timeout', values.timeout);
      return {
        command: 'scan',
        url,
        format: format as OutputFormat,
        ...(values.profile !== undefined ? { profile: values.profile } : {}),
        ...(budget !== undefined ? { budget } : {}),
        ...(sampleSize !== undefined ? { sampleSize } : {}),
        ...(timeoutMs !== undefined ? { timeoutMs } : {}),
        ...(values.fixture !== undefined ? { fixture: values.fixture } : {}),
        ...(values.output !== undefined ? { output: values.output } : {}),
      };
    }
    case 'diff': {
      const [, before, after] = positionals;
      if (!before || !after) throw new Error('diff needs two JSON report files\n\n' + USAGE);
      const format = values.format ?? 'text';
      if (format !== 'text' && format !== 'json') throw new Error(`unknown format ${format}`);
      return { command: 'diff', before, after, format };
    }
    case 'mcp':
    case 'catalog':
    case 'help':
    case 'version':
      return { command };
    case undefined:
      return { command: 'help' };
    default:
      throw new Error(`unknown command ${command}\n\n${USAGE}`);
  }
}
