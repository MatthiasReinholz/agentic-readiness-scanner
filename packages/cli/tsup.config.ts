import { defineConfig } from 'tsup';

/**
 * The published CLI (and local MCP server) is self-contained: every workspace package is
 * bundled in, so `npx @agentic-readiness/cli` installs one package plus its third-party
 * runtime dependencies.
 */
export default defineConfig({
  entry: { index: 'src/index.ts' },
  format: ['esm'],
  platform: 'node',
  target: 'node22',
  splitting: false,
  sourcemap: true,
  clean: true,
  dts: { resolve: [/^@agentic-readiness\//] },
  noExternal: [/^@agentic-readiness\//, 'class-variance-authority', 'clsx', 'tailwind-merge'],
});
