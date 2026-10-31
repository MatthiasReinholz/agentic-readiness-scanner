// @ts-check
import js from '@eslint/js';
import prettier from 'eslint-config-prettier';
import globals from 'globals';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    ignores: [
      '**/dist/**',
      '**/node_modules/**',
      '**/.turbo/**',
      'packages/catalog/src/generated/**',
      '**/vitest.config.ts',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.strictTypeChecked,
  ...tseslint.configs.stylisticTypeChecked,
  {
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
      globals: { ...globals.node, ...globals.browser },
    },
    rules: {
      '@typescript-eslint/consistent-type-imports': ['error', { prefer: 'type-imports' }],
      '@typescript-eslint/no-unnecessary-condition': 'off',
      '@typescript-eslint/restrict-template-expressions': ['error', { allowNumber: true }],
    },
  },
  {
    // The hosted app runs on a worker. Node-only globals are withdrawn there so a stray
    // `process` or `Buffer` fails lint as well as the type-check (tsconfig.app.json has no
    // Node types). dev.ts and the tests run on Node and keep them (tsconfig.node.json).
    files: ['apps/web/src/**/*.ts'],
    ignores: ['apps/web/src/dev.ts', 'apps/web/src/**/*.test.ts'],
    languageOptions: {
      globals: Object.fromEntries(
        Object.keys(globals.node)
          .filter((name) => !(name in globals.browser))
          .map((name) => [name, 'off']),
      ),
    },
  },
  {
    files: ['**/*.js', '**/*.mjs'],
    ...tseslint.configs.disableTypeChecked,
  },
  prettier,
);
