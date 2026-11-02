import { defineConfig } from 'tsup';

/**
 * The published engine is self-contained: the catalog (data and schemas) and the visual
 * system are bundled in, so a consumer installs one package. Third-party runtime
 * dependencies stay external and are declared in package.json.
 */
export default defineConfig({
  entry: { index: 'src/index.ts', 'testing/index': 'src/testing/index.ts' },
  format: ['esm'],
  platform: 'node',
  target: 'node22',
  splitting: true,
  sourcemap: true,
  clean: true,
  dts: { resolve: ['@agentic-readiness/catalog', '@agentic-readiness/ui'] },
  noExternal: [
    '@agentic-readiness/catalog',
    '@agentic-readiness/ui',
    'class-variance-authority',
    'clsx',
    'tailwind-merge',
  ],
});
