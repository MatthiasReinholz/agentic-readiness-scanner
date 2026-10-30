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

  it('flags a file without title or links as malformed', () => {
    expect(isWellFormedLlmsTxt(parseLlmsTxt('Just some prose.'))).toBe(false);
  });
});
