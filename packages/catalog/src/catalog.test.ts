import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { parseFixMarkdown } from './fixes.js';
import { loadCatalogFromDisk } from './load.js';
import { validateCatalogIntegrity } from './schema.js';

const packageRoot = join(dirname(fileURLToPath(import.meta.url)), '..');

describe('catalog data', () => {
  const catalog = loadCatalogFromDisk(packageRoot);

  it('loads and passes integrity validation', () => {
    expect(validateCatalogIntegrity(catalog)).toEqual([]);
  });

  it('has 55 checks across 9 groups and 6 levels', () => {
    expect(catalog.checks).toHaveLength(55);
    expect(catalog.groups).toHaveLength(9);
    expect(catalog.levels).toHaveLength(6);
  });

  it('grounds every check in at least one public https spec', () => {
    for (const check of catalog.checks) {
      expect(check.spec.length, check.id).toBeGreaterThan(0);
      for (const ref of check.spec) expect(ref.url, check.id).toMatch(/^https:\/\//);
    }
  });

  it('only tags WooCommerce-specific checks as requiring woocommerce', () => {
    const tagged = catalog.checks
      .filter((check) => check.requires.includes('woocommerce'))
      .map((c) => c.id);
    expect(tagged).toEqual(['B1.2', 'B1.3', 'B1.4', 'B1.7', 'B5.7']);
  });
});

describe('parseFixMarkdown', () => {
  it('parses summary, snippet and agent prompt', () => {
    const fix = parseFixMarkdown(
      [
        '---',
        'auto_fix: true',
        '---',
        '## Summary',
        'Do the thing.',
        '',
        '## Snippet',
        '```txt',
        'a: b',
        '```',
        '',
        '## Agent prompt',
        'Please do the thing.',
      ].join('\n'),
      'X.md',
    );
    expect(fix).toEqual({
      summary: 'Do the thing.',
      snippet: 'a: b',
      snippet_language: 'txt',
      agent_prompt: 'Please do the thing.',
      auto_fix: true,
    });
  });

  it('rejects a file without an agent prompt', () => {
    expect(() =>
      parseFixMarkdown(
        ['---', 'auto_fix: false', '---', '## Summary', 'Only a summary.'].join('\n'),
        'Y.md',
      ),
    ).toThrow(/agent_prompt/);
  });
});
