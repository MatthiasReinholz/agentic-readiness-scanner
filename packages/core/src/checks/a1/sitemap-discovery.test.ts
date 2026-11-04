import { describe, expect, it } from 'vitest';

import { mapFetcher, runCheck, targetFor } from '../../testing/index.js';
import { sitemapReachable } from './index.js';

describe('A1.2 when no sitemap was read', () => {
  it('skips with reason error instead of failing when discovery did not finish', async () => {
    const target = {
      ...targetFor(),
      sitemapDiscovery: {
        complete: false,
        reason: 'https://shop.example/sitemap.xml answered HTTP 429, so discovery stopped there',
        tried: ['https://shop.example/sitemap.xml'],
      },
    };
    const outcome = await runCheck(sitemapReachable, target, mapFetcher({}));
    expect(outcome.verdict).toBe('skip');
    expect(outcome.skipReason).toBe('error');
    expect(outcome.message).toBe(
      'could not tell whether a sitemap exists: https://shop.example/sitemap.xml answered HTTP 429, so discovery stopped there',
    );
    expect(outcome.evidence).toMatchObject({ tried: ['https://shop.example/sitemap.xml'] });
  });

  it('fails naming the paths it tried when every request answered', async () => {
    const target = {
      ...targetFor({ platform: 'shopify' }),
      sitemapDiscovery: {
        complete: true,
        tried: ['https://shop.example/sitemap.xml', 'https://shop.example/sitemap_index.xml'],
      },
    };
    const outcome = await runCheck(sitemapReachable, target, mapFetcher({}));
    expect(outcome.verdict).toBe('fail');
    expect(outcome.message).toBe('no sitemap found via /sitemap.xml, /sitemap_index.xml');
  });

  it('keeps the old message for a target built without a discovery record', async () => {
    const outcome = await runCheck(sitemapReachable, targetFor(), mapFetcher({}));
    expect(outcome.verdict).toBe('fail');
    expect(outcome.message).toMatch(/^no sitemap found via robots\.txt, \/sitemap\.xml/);
  });
});
