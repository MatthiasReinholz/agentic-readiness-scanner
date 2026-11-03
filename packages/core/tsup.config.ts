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
  // The catalog and the visual system are private, so their types are inlined too. Mapping
  // them to their sources lets the declaration bundler follow their relative imports;
  // resolving the packages' built .d.ts would leave those imports dangling.
  dts: {
    compilerOptions: {
      paths: {
        '@agentic-readiness/catalog': ['../catalog/src/index.ts'],
        '@agentic-readiness/ui': ['../ui/src/index.ts'],
      },
    },
  },
  noExternal: [
    '@agentic-readiness/catalog',
    '@agentic-readiness/ui',
    'class-variance-authority',
    'clsx',
    'tailwind-merge',
  ],
});
