import { describe, expect, it } from 'vitest';

import { isWellFormedLlmsTxt, parseLlmsTxt } from './llms-txt.js';

describe('parseLlmsTxt', () => {
  it('extracts title, summary, sections and links', () => {
    const parsed = parseLlmsTxt(
      '# Shop\n\n> A shop.\n\n## Catalog\n\n- [Feed](https://x.example/feed.xml): hourly\n\n## Policies\n- [Returns](https://x.example/returns/)',
    );
    expect(parsed.title).toBe('Shop');
    expect(parsed.summary).toBe('A shop.');
    expect(parsed.sections).toEqual(['Catalog', 'Policies']);
    expect(parsed.links).toEqual([
      { text: 'Feed', url: 'https://x.example/feed.xml', section: 'Catalog' },
      { text: 'Returns', url: 'https://x.example/returns/', section: 'Policies' },
    ]);
    expect(isWellFormedLlmsTxt(parsed)).toBe(true);
  });

  it('keeps link titles out of the URL and ignores unbalanced brackets', () => {
    const parsed = parseLlmsTxt(
      '# T\n- [Docs](https://a.example/docs "Documentation") and [x](y\n',
    );
    expect(parsed.links).toEqual([{ text: 'Docs', url: 'https://a.example/docs', section: null }]);
  });

  it('parses hostile input in linear time', () => {
    const hostile = `# T\n${'['.repeat(50_000)}${'[](!'.repeat(20_000)}`;
    const started = performance.now();
    const parsed = parseLlmsTxt(hostile);
    // A regression guard against super-linear blowups (those take minutes), not a speed
    // test: the bound is generous so a loaded CI runner never trips it.
    expect(performance.now() - started).toBeLessThan(3000);
    expect(parsed.links).toEqual([]);
  });

  it('flags a file without title or links as malformed', () => {
    expect(isWellFormedLlmsTxt(parseLlmsTxt('Just some prose.'))).toBe(false);
  });
});
