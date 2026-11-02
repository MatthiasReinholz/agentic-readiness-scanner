import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { parseFixMarkdown } from './fixes.js';
import { parseKnowledgeMarkdown } from './knowledge.js';
import { loadCatalogFromDisk, loadKnowledgeFromDisk } from './load.js';
import { validateCatalogIntegrity } from './schema.js';

const packageRoot = join(dirname(fileURLToPath(import.meta.url)), '..');

describe('catalog data', () => {
  const catalog = loadCatalogFromDisk(packageRoot);

  it('loads and passes integrity validation', () => {
    expect(validateCatalogIntegrity(catalog)).toEqual([]);
  });

  it('has 64 checks across 9 groups and 6 levels', () => {
    expect(catalog.checks).toHaveLength(64);
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

describe('knowledge base', () => {
  const catalog = loadCatalogFromDisk(packageRoot);

  it('has one valid article per check with unique slugs and resolving links', () => {
    const articles = loadKnowledgeFromDisk(packageRoot, catalog);
    expect(articles.map((article) => article.id)).toEqual(catalog.checks.map((check) => check.id));
  });

  it('rejects articles that break the format', () => {
    const valid = `---
slug: a-valid-slug
headline: A headline long enough
description: ${'x'.repeat(120)}
keywords: one, two, three
---

## In short
## What this check looks at
## Why it matters for AI agents
## How the scanner decides
## How to fix it
## Verify it yourself
## Common mistakes
## FAQ
### One?
### Two?
### Three?
`;
    expect(parseKnowledgeMarkdown(valid, 'A1.1.md').slug).toBe('a-valid-slug');
    expect(() =>
      parseKnowledgeMarkdown(valid.replace('## FAQ', '## Questions'), 'A1.1.md'),
    ).toThrow(/sections/);
    expect(() =>
      parseKnowledgeMarkdown(valid.replace('### Three?', '### Three'), 'A1.1.md'),
    ).toThrow(/not a question/);
    expect(() => parseKnowledgeMarkdown(`${valid}\n<div>raw</div>\n`, 'A1.1.md')).toThrow(
      /raw HTML/,
    );
    expect(() => parseKnowledgeMarkdown(`${valid}\nA \u2014 B\n`, 'A1.1.md')).toThrow(/em dashes/);
    expect(() =>
      parseKnowledgeMarkdown(valid.replace('a-valid-slug', 'Bad Slug'), 'A1.1.md'),
    ).toThrow(/slug/);
  });
});
