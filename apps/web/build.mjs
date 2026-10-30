// Bundles the worker entry for Spacefast Functions into dist/ and copies static files.
// esbuild resolves workspace packages, so the published folder is self-contained.
import { build } from 'esbuild';
import { cpSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';

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
writeFileSync('dist/.gitkeep', '');
console.log('Built dist/handler.js');
