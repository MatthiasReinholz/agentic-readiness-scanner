import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { parseFixMarkdown } from './fixes.js';
import { parseGuideMarkdown, parseKnowledgeMarkdown } from './knowledge.js';
import { fixForPlatform } from './platforms.js';
import { loadCatalogFromDisk, loadGuidesFromDisk, loadKnowledgeFromDisk } from './load.js';
import { validateCatalogIntegrity } from './schema.js';

const packageRoot = join(dirname(fileURLToPath(import.meta.url)), '..');

describe('catalog data', () => {
  const catalog = loadCatalogFromDisk(packageRoot);

  it('loads and passes integrity validation', () => {
    expect(validateCatalogIntegrity(catalog)).toEqual([]);
  });

  it('has 79 checks across 9 groups and 6 levels', () => {
    expect(catalog.checks).toHaveLength(79);
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
      platform_notes: [],
    });
  });

  const withNotes = [
    '---',
    'auto_fix: false',
    '---',
    '## Summary',
    'Do the thing.',
    '',
    '## Agent prompt',
    'Please do the thing.',
    '',
    '## On WordPress',
    'Use a hook.',
    '',
    '## On Shopify',
    'Use the theme editor.',
  ].join('\n');

  it('parses platform sections into notes', () => {
    expect(parseFixMarkdown(withNotes, 'X.md').platform_notes).toEqual([
      { platform: 'wordpress', text: 'Use a hook.' },
      { platform: 'shopify', text: 'Use the theme editor.' },
    ]);
  });

  it('rejects an unknown section, so a misspelled platform is caught', () => {
    expect(() =>
      parseFixMarkdown(withNotes.replace('## On Shopify', '## On Shopfiy'), 'X.md'),
    ).toThrow(/unknown section "on shopfiy"/);
  });

  it('accepts a platform section by label or by id', () => {
    const byLabel = parseFixMarkdown(
      withNotes.replace('## On Shopify', '## On Adobe Commerce (Magento)'),
      'X.md',
    );
    const byId = parseFixMarkdown(withNotes.replace('## On Shopify', '## On Magento'), 'X.md');
    expect(byLabel.platform_notes.map((note) => note.platform)).toContain('magento');
    expect(byId.platform_notes.map((note) => note.platform)).toContain('magento');
  });

  it("folds only the detected platform's notes into the agent prompt", () => {
    const fix = parseFixMarkdown(withNotes, 'X.md');
    expect(fixForPlatform(fix, 'woocommerce').agent_prompt).toBe(
      'Please do the thing. On WordPress: Use a hook.',
    );
    expect(fixForPlatform(fix, 'shopify').agent_prompt).toBe(
      'Please do the thing. On Shopify: Use the theme editor.',
    );
    expect(fixForPlatform(fix, 'unknown')).toEqual({
      summary: 'Do the thing.',
      agent_prompt: 'Please do the thing.',
      auto_fix: false,
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
    expect(articles.map((article) => article.id)).toEqual(
      [...catalog.checks, ...catalog.legal.checks].map((check) => check.id),
    );
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

  it('loads the guides, whose related checks exist and whose links resolve', () => {
    const guides = loadGuidesFromDisk(
      packageRoot,
      catalog,
      loadKnowledgeFromDisk(packageRoot, catalog),
    );
    expect(guides.length).toBeGreaterThan(0);
    expect(guides.map((guide) => guide.slug)).toContain('crawler-blocks-and-browser-scans');
  });

  it('rejects guides without an answer first or public sources last', () => {
    const valid = `---
slug: a-guide
headline: A guide headline long enough
description: ${'x'.repeat(120)}
keywords: one, two, three
related: A2.4
---

## In short
## One topic
## Another topic
## Sources
- [First](https://example.com/one)
- [Second](https://example.com/two)
`;
    expect(parseGuideMarkdown(valid, 'a-guide.md')).toMatchObject({
      slug: 'a-guide',
      related: ['A2.4'],
    });
    expect(() => parseGuideMarkdown(valid, 'other.md')).toThrow(/file name/);
    expect(() =>
      parseGuideMarkdown(valid.replace('## In short', '## Intro'), 'a-guide.md'),
    ).toThrow(/first section/);
    expect(() =>
      parseGuideMarkdown(valid.replace('## Sources', '## Further reading'), 'a-guide.md'),
    ).toThrow(/last section/);
    expect(() =>
      parseGuideMarkdown(valid.replace('- [Second](https://example.com/two)', ''), 'a-guide.md'),
    ).toThrow(/at least two/);
    expect(() =>
      parseGuideMarkdown(
        valid.replace('## Sources', '## FAQ\n### Only one?\n## Sources'),
        'a-guide.md',
      ),
    ).toThrow(/three to six/);
  });
});

describe('legal signals', () => {
  const catalog = loadCatalogFromDisk(packageRoot);

  it('keeps legal checks apart, unscored, and citing laws that resolve to official texts', () => {
    expect(catalog.legal.checks).toHaveLength(24);
    expect(catalog.checks.some((check) => check.id.startsWith('C'))).toBe(false);
    const laws = new Map(catalog.legal.laws.map((law) => [law.id, law]));
    for (const check of catalog.legal.checks) {
      expect(check.weight).toBe('info');
      expect(check.laws.length).toBeGreaterThan(0);
      for (const id of check.laws) expect(laws.get(id)?.url).toMatch(/^https:\/\//);
    }
  });
});
