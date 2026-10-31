// Bundles the worker entry for Spacefast Functions into dist/ and copies static files
// and the runtime configuration. esbuild resolves workspace packages from their built
// dist/ folders, so run it through turbo (`pnpm build` at the repository root), which
// builds those packages first; the published folder is then self-contained.
import { build } from 'esbuild';
import { cpSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';

import { FONT_FILES } from '@agentic-readiness/ui';

rmSync('dist', { recursive: true, force: true });
mkdirSync('dist', { recursive: true });

await build({
  entryPoints: ['src/handler.ts'],
  outfile: 'dist/handler.js',
  bundle: true,
  format: 'esm',
  platform: 'neutral',
  target: 'es2023',
  mainFields: ['workerd', 'worker', 'browser', 'module', 'main'],
  conditions: ['workerd', 'worker', 'browser', 'import', 'default'],
  minify: false,
  sourcemap: false,
  logLevel: 'info',
});

cpSync('public', 'dist', { recursive: true });
// Self-hosted Inter (latin subset, the weights the design uses), served under /fonts.
const require = createRequire(import.meta.url);
const fontDir = join(dirname(require.resolve('@fontsource/inter/package.json')), 'files');
mkdirSync('dist/fonts', { recursive: true });
for (const { file } of FONT_FILES) cpSync(join(fontDir, file), join('dist/fonts', file));
// Spacefast reads sf.jsonc from the root of the published directory.
cpSync('sf.jsonc', 'dist/sf.jsonc');
writeFileSync('dist/.gitkeep', '');
console.log('Built dist/handler.js');
