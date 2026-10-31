import { SCANNER_VERSION } from '@agentic-readiness/core';

import { parseCliArguments, USAGE } from './args.js';
import { renderCatalog } from './commands/catalog.js';
import { runDiff } from './commands/diff.js';
import { runMcp } from './commands/mcp.js';
import { runScan } from './commands/scan.js';

export { parseCliArguments, USAGE } from './args.js';
export { render } from './commands/scan.js';

export async function main(
  argv: readonly string[],
  io: { stdout: (text: string) => void; stderr: (text: string) => void } = {
    stdout: (text) => process.stdout.write(text),
    stderr: (text) => process.stderr.write(text),
  },
): Promise<number> {
  let args;
  try {
    args = parseCliArguments(argv);
  } catch (error) {
    io.stderr(`${error instanceof Error ? error.message : String(error)}\n`);
    return 1;
  }
  switch (args.command) {
    case 'scan':
      return runScan(args, io.stdout, io.stderr);
    case 'diff':
      return runDiff(args, io.stdout, io.stderr);
    case 'mcp':
      return runMcp();
    case 'catalog':
      io.stdout(renderCatalog());
      return 0;
    case 'version':
      io.stdout(`${SCANNER_VERSION}\n`);
      return 0;
    case 'help':
      io.stdout(USAGE);
      return 0;
  }
}
