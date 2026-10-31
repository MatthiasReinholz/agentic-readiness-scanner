import { describe, expect, it } from 'vitest';

import { mapFetcher, runCheck, targetFor, type TargetOptions } from '../../testing/index.js';
import { llmsTxtLinksToCatalog, llmsTxtPresent, robotsTxtExists } from './index.js';

describe('A1.1 robots.txt exists and parses', () => {
  const run = (robots: NonNullable<TargetOptions['robots']> | null) =>
    runCheck(robotsTxtExists, targetFor({ robots }), mapFetcher({}));

  it('passes on a parseable robots.txt and counts its groups', async () => {
    const outcome = await run('User-agent: *\nAllow: /\n\nUser-agent: GPTBot\nDisallow: /\n');
    expect(outcome.verdict).toBe('pass');
    expect(outcome.evidence).toMatchObject({ status: 200, groups: 2, content_type: 'text/plain' });
  });

  it('fails when a 200 answers with HTML (challenge page or soft 404)', async () => {
    const outcome = await run({
      status: 200,
      headers: { 'content-type': 'text/html' },
      body: '<!doctype html><html><body>Checking your browser</body></html>',
    });
    expect(outcome.verdict).toBe('fail');
    expect(outcome.message).toMatch(/HTML/);
    expect(outcome.evidence).toMatchObject({ groups: 0, content_type: 'text/html' });
  });

  it('warns on 404: allowed by default, intent unstated', async () => {
    const outcome = await run(null);
    expect(outcome.verdict).toBe('warn');
    expect(outcome.message).toMatch(/missing/);
  });

  it('warns on 403 and other 4xx, which RFC 9309 treats as "unavailable, allow all"', async () => {
    for (const status of [401, 403, 410, 451]) {
      const outcome = await run({ status, body: 'Forbidden' });
      expect(outcome.verdict, `HTTP ${status}`).toBe('warn');
      expect(outcome.message).toContain(`HTTP ${status}`);
      expect(outcome.evidence).toMatchObject({ status });
    }
  });

  it('fails on 5xx, which crawlers must treat as "unreachable, disallow all"', async () => {
    const outcome = await run({ status: 503, body: 'down' });
    expect(outcome.verdict).toBe('fail');
    expect(outcome.message).toBe('robots.txt returned HTTP 503');
  });

  it('fails when nothing answered at all', async () => {
    const outcome = await run({ status: 0 });
    expect(outcome.verdict).toBe('fail');
    expect(outcome.message).toMatch(/could not be fetched: network error/);
  });
});

describe('A1.5 and A1.6 llms.txt', () => {
  const target = targetFor();
  const url = 'https://shop.example/llms.txt';

  it('skips when llms.txt is missing, fails on HTML or no H1, warns without links, passes when well formed', async () => {
    const missing = await runCheck(llmsTxtPresent, target, mapFetcher({}));
    expect(missing.verdict).toBe('skip');
    expect(missing.skipReason).toBe('not_applicable');
    const html = await runCheck(
      llmsTxtPresent,
      target,
      mapFetcher({ [url]: '<!doctype html><html></html>' }),
    );
    expect(html.verdict).toBe('fail');
    expect(html.message).toMatch(/HTML/);
    const prose = await runCheck(llmsTxtPresent, target, mapFetcher({ [url]: 'Just prose.' }));
    expect(prose.verdict).toBe('fail');
    expect(prose.message).toMatch(/H1/);
    const noLinks = await runCheck(
      llmsTxtPresent,
      target,
      mapFetcher({ [url]: '# Shop\n\n> Ceramics.\n' }),
    );
    expect(noLinks.verdict).toBe('warn');
    const good = await runCheck(
      llmsTxtPresent,
      target,
      mapFetcher({
        [url]: '# Shop\n\n> Ceramics.\n\n## Catalog\n\n- [Feed](https://shop.example/feed.xml)\n',
      }),
    );
    expect(good.verdict).toBe('pass');
    expect(good.evidence).toMatchObject({ title: 'Shop', links: 1 });
  });

  it('passes A1.6 only when a link points at a feed, Store API or product index', async () => {
    const none = await runCheck(
      llmsTxtLinksToCatalog,
      target,
      mapFetcher({ [url]: '# Shop\n\n## About\n\n- [Team](https://shop.example/team/)\n' }),
    );
    expect(none.verdict).toBe('fail');
    const some = await runCheck(
      llmsTxtLinksToCatalog,
      target,
      mapFetcher({
        [url]:
          '# Shop\n\n## Data\n\n- [Products](https://shop.example/wp-json/wc/store/v1/products)\n',
      }),
    );
    expect(some.verdict).toBe('pass');
    expect(some.evidence).toEqual({
      catalog_links: ['https://shop.example/wp-json/wc/store/v1/products'],
    });
  });
});
