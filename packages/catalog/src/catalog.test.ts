import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { parseFixMarkdown } from './fixes.js';
import { parseGuideMarkdown, parseKnowledgeMarkdown } from './knowledge.js';
import { fixForPlatform, requiredPlatform } from './platforms.js';
import { loadCatalogFromDisk, loadGuidesFromDisk, loadKnowledgeFromDisk } from './load.js';
import { crawlerSet, expandCrawlerPlaceholders, CrawlerSetError } from './crawlers.js';
import {
  validateCatalogIntegrity,
  validateCrawlerRegistry,
  type CrawlerRegistry,
} from './schema.js';

const packageRoot = join(dirname(fileURLToPath(import.meta.url)), '..');

describe('catalog data', () => {
  const catalog = loadCatalogFromDisk(packageRoot);

  it('loads and passes integrity validation', () => {
    expect(validateCatalogIntegrity(catalog)).toEqual([]);
  });

  it('has 87 checks across 9 groups and 6 levels', () => {
    expect(catalog.checks).toHaveLength(87);
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
    expect(tagged).toEqual(['B1.2', 'B1.4', 'B1.7', 'B5.7', 'B5.12']);
  });

  it('refuses a technology check that is scored or bound to no platform', () => {
    const base = catalog.checks.find((check) => check.id === 'A3.15');
    if (!base) throw new Error('A3.15 missing');
    const broken = {
      ...catalog,
      checks: catalog.checks.map((check) =>
        check.id === 'A3.15' ? { ...base, weight: 1 as const, requires: [] } : check,
      ),
    };
    expect(validateCatalogIntegrity(broken)).toEqual(
      expect.arrayContaining([
        'A3.15: technology checks are never scored (weight info)',
        'A3.15: a technology check is bound to one platform',
      ]),
    );
  });

  it('keeps technology checks informational and bound to one platform', () => {
    const technology = catalog.checks.filter((check) => check.technology);
    expect(technology.map((check) => check.id)).toEqual([
      'A3.15',
      'A3.16',
      'A3.17',
      'A3.18',
      'A3.19',
      'B5.12',
    ]);
    for (const check of technology) {
      expect(check.weight, check.id).toBe('info');
      expect(requiredPlatform(check), check.id).not.toBeNull();
    }
    for (const level of catalog.levels)
      for (const gate of level.gates)
        for (const id of gate)
          expect(
            technology.some((check) => check.id === id),
            id,
          ).toBe(false);
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

describe('crawler registry', () => {
  const catalog = loadCatalogFromDisk(packageRoot);
  const registry = catalog.crawlers;
  const tokens = (name: string) => crawlerSet(registry, name).map((crawler) => crawler.token);

  it('documents every token with an operator page and a verification date', () => {
    for (const crawler of registry.tokens) {
      expect(crawler.docs, crawler.token).toMatch(/^https:\/\//);
      expect(crawler.verified, crawler.token).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    }
  });

  it('keeps Google and Bing as the only core indexes', () => {
    expect(tokens('index.core')).toEqual(['Googlebot', 'Bingbot']);
  });

  it('puts Google-Extended in both the training and the index set', () => {
    expect(tokens('training')).toContain('Google-Extended');
    expect(tokens('index')).toContain('Google-Extended');
  });

  it('narrows sets by tier and by robots behaviour', () => {
    expect(tokens('fetchers.may-ignore')).toContain('ChatGPT-User');
    expect(tokens('fetchers.honours')).toContain('Claude-User');
    expect(tokens('fetchers.assistant')).not.toContain('FirecrawlAgent');
  });

  it('rejects unknown sets, filters and placeholder typos', () => {
    expect(() => crawlerSet(registry, 'bots')).toThrow(CrawlerSetError);
    expect(() => crawlerSet(registry, 'index.major')).toThrow(CrawlerSetError);
    expect(() => expandCrawlerPlaceholders('{{ crawlers:index }}', registry)).toThrow(
      CrawlerSetError,
    );
  });

  it('writes lists, robots.txt lines and counts, and leaves other braces alone', () => {
    expect(expandCrawlerPlaceholders('{{crawlers:index.core}}', registry)).toBe(
      'Googlebot and Bingbot',
    );
    expect(expandCrawlerPlaceholders('{{robots:index.core}}', registry)).toBe(
      'User-agent: Googlebot\nUser-agent: Bingbot',
    );
    expect(expandCrawlerPlaceholders('{{count:index.core}}', registry)).toBe('2');
    expect(expandCrawlerPlaceholders('{{ request.locale.iso_code }}', registry)).toBe(
      '{{ request.locale.iso_code }}',
    );
  });

  it('leaves no placeholder in the generated catalog', () => {
    expect(JSON.stringify(catalog)).not.toMatch(/\{\{(crawlers|robots|count):/);
  });

  it('reports duplicate tokens, missing tiers and dangling references', () => {
    const first = registry.tokens[0];
    const legacy = registry.legacy[0];
    if (!first || !legacy) throw new Error('the registry needs a token and a legacy entry');
    const broken: CrawlerRegistry = {
      ...registry,
      tokens: [
        ...registry.tokens,
        { ...first, token: 'gptbot' },
        { ...first, token: 'NoTier', purposes: ['search'] },
        { ...first, token: 'Follower', follows: 'Nobody' },
      ],
      legacy: [{ ...legacy, token: 'old-bot', replaced_by: ['Ghost'] }],
    };
    const problems = validateCrawlerRegistry(broken);
    expect(problems).toContain('crawlers: duplicate token gptbot');
    expect(problems).toContain('crawlers: NoTier serves search or answers but has no tier');
    expect(problems).toContain('crawlers: Follower follows unknown token Nobody');
    expect(problems).toContain('crawlers: legacy old-bot is replaced by unknown token Ghost');
  });
});
