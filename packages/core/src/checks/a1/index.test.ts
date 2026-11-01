import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { resolveTarget } from '../../target/resolver.js';
import type { SitemapSummary } from '../../target/types.js';
import {
  fixtureFetcher,
  mapFetcher,
  runCheck,
  targetFor,
  type TargetOptions,
} from '../../testing/index.js';
import {
  linkResponseHeaders,
  listingLinksProductsAndPages,
  llmsTxtLinksToCatalog,
  llmsTxtPresent,
  robotsTxtExists,
  sitemapLastmodPlausible,
} from './index.js';

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

describe('A1.4 Link response headers', () => {
  const mug = 'https://shop.example/product/mug/';

  it('passes when the home page sends a relation an agent can use and lists every link', async () => {
    const target = targetFor();
    target.home.headers.link = '</llms.txt>; rel="llms-txt", </style.css>; rel=preload; as=style';
    const outcome = await runCheck(linkResponseHeaders, target, mapFetcher({}));
    expect(outcome.verdict).toBe('pass');
    expect(outcome.message).toBe('Link header relation(s) an agent can use: llms-txt');
    expect(outcome.evidence).toMatchObject({
      pages: ['https://shop.example/'],
      usable: 1,
      links: [
        { href: 'https://shop.example/llms.txt', rel: ['llms-txt'], type: null, usable: true },
        { href: 'https://shop.example/style.css', rel: ['preload'], usable: false },
      ],
    });
  });

  it('passes on a typed relation sent by the first sampled product page', async () => {
    const outcome = await runCheck(
      linkResponseHeaders,
      targetFor({ products: [mug] }),
      mapFetcher({
        [mug]: {
          status: 200,
          headers: {
            'content-type': 'text/html',
            Link: '</product/mug.md>; rel=alternate; type="text/markdown"',
          },
          body: '<html></html>',
        },
      }),
    );
    expect(outcome.verdict).toBe('pass');
    expect(outcome.evidence).toMatchObject({
      pages: ['https://shop.example/', mug],
      links: [
        {
          page: mug,
          href: 'https://shop.example/product/mug.md',
          rel: ['alternate'],
          type: 'text/markdown',
          usable: true,
        },
      ],
    });
  });

  it('fails when the links present carry no usable relation (license without the RSL type)', async () => {
    const target = targetFor();
    target.home.headers.link =
      '</license>; rel=license; type="text/html", </feed>; rel=alternate; type="application/rss+xml"';
    const outcome = await runCheck(linkResponseHeaders, target, mapFetcher({}));
    expect(outcome.verdict).toBe('fail');
    expect(outcome.message).toBe(
      '2 Link header value(s) but none with a relation an agent can use',
    );
    expect(outcome.evidence).toMatchObject({ usable: 0 });
  });

  it('fails when neither page sends a Link header', async () => {
    const outcome = await runCheck(
      linkResponseHeaders,
      targetFor({ products: [mug] }),
      mapFetcher({ [mug]: '<html></html>' }),
    );
    expect(outcome.verdict).toBe('fail');
    expect(outcome.message).toMatch(/no Link response header/);
    expect(outcome.evidence).toEqual({
      pages: ['https://shop.example/', mug],
      links: [],
      usable: 0,
    });
  });
});

describe('A1.7 sitemap lastmod present and plausible', () => {
  const summary = (lastmods: string[], entries = lastmods.length): SitemapSummary => ({
    url: 'https://shop.example/sitemap.xml',
    kind: 'urlset',
    childSitemaps: [],
    fetchedSitemaps: [],
    urls: Array.from({ length: entries }, (_, index) => `https://shop.example/product/p${index}/`),
    productUrls: [],
    lastmods,
  });
  const run = (sitemap: SitemapSummary | null) =>
    runCheck(sitemapLastmodPlausible, targetFor({ sitemap }), mapFetcher({}));

  it('skips when no sitemap was found', async () => {
    const outcome = await run(null);
    expect(outcome.verdict).toBe('skip');
    expect(outcome.skipReason).toBe('dependency_failed');
  });

  it('does not apply when the sitemaps read list no URL entries', async () => {
    const outcome = await run(summary([], 0));
    expect(outcome.verdict).toBe('skip');
    expect(outcome.skipReason).toBe('not_applicable');
    expect(outcome.evidence).toMatchObject({ entries_read: 0 });
  });

  it('passes when at least 80 percent carry a valid lastmod and the values differ', async () => {
    const outcome = await run(
      summary(['2026-10-01', '2026-09-15T08:00:00Z', '2026-08-01', '2026-07-01'], 5),
    );
    expect(outcome.verdict).toBe('pass');
    expect(outcome.message).toBe(
      '4 of 5 sitemap entries read carry a valid lastmod with 4 distinct value(s)',
    );
    expect(outcome.evidence).toMatchObject({
      sitemaps_read: ['https://shop.example/sitemap.xml'],
      entries_read: 5,
      with_lastmod: 4,
      valid_lastmod: 4,
      distinct_values: 4,
      share: 0.8,
      sample: ['2026-10-01', '2026-09-15T08:00:00Z', '2026-08-01', '2026-07-01'],
    });
  });

  it('passes a one-entry sitemap whose single lastmod is valid', async () => {
    const outcome = await run(summary(['2026-10-01']));
    expect(outcome.verdict).toBe('pass');
    expect(outcome.evidence).toMatchObject({ entries_read: 1, distinct_values: 1 });
  });

  it('warns when fewer than 80 percent carry a valid lastmod, counting malformed values as missing', async () => {
    const outcome = await run(summary(['2026-10-01', '2026-09-15', 'yesterday'], 5));
    expect(outcome.verdict).toBe('warn');
    expect(outcome.message).toMatch(/2 of 5 .*under 80 percent/);
    expect(outcome.evidence).toMatchObject({
      with_lastmod: 3,
      valid_lastmod: 2,
      invalid_lastmod: 1,
      invalid_sample: ['yesterday'],
      share: 0.4,
    });
  });

  it('warns when every lastmod is the same value', async () => {
    const stamp = '2026-10-31T12:00:00Z';
    const outcome = await run(summary([stamp, stamp, stamp]));
    expect(outcome.verdict).toBe('warn');
    expect(outcome.message).toMatch(/stamped at request time/);
    expect(outcome.evidence).toMatchObject({ valid_lastmod: 3, distinct_values: 1 });
  });

  it('fails when no entry carries a lastmod, or none of them is a W3C datetime', async () => {
    const none = await run(summary([], 3));
    expect(none.verdict).toBe('fail');
    expect(none.message).toBe('none of the 3 sitemap entries read carries <lastmod>');
    const invalid = await run(summary(['1759309200', 'n/a']));
    expect(invalid.verdict).toBe('fail');
    expect(invalid.message).toBe('2 lastmod value(s) found but none is a valid W3C datetime');
    expect(invalid.evidence).toMatchObject({ invalid_sample: ['1759309200', 'n/a'] });
  });
});

describe('A1.8 listing pages link to products and further pages', () => {
  const listing = 'https://shop.example/shop/';
  const products = (count: number) =>
    Array.from({ length: count }, (_, i) => `<a href="/product/mug-${i}/">Mug ${i}</a>`).join('');
  const html = (body: string, head = '') =>
    `<!doctype html><html><head><title>Shop</title>${head}</head><body>${body}</body></html>`;
  const run = (pages: Record<string, string | { status: number; body?: string }>) =>
    runCheck(listingLinksProductsAndPages, targetFor({ listing }), mapFetcher(pages));

  it('does not apply when the home page links to no listing page', async () => {
    const outcome = await runCheck(listingLinksProductsAndPages, targetFor(), mapFetcher({}));
    expect(outcome.verdict).toBe('skip');
    expect(outcome.skipReason).toBe('not_applicable');
  });

  it('passes when products and page links are plain anchors, ignoring off-origin and page-number URLs', async () => {
    const outcome = await run({
      [listing]: html(
        `${products(3)}<a href="https://other.example/product/x/">x</a><a href="/shop/page/2/">2</a><a href="/products/page/3/">3</a><a href="/shop/?paged=4">4</a><a href="/shop/#top">top</a>`,
      ),
    });
    expect(outcome.verdict).toBe('pass');
    expect(outcome.message).toBe('3 product link(s) and 3 pagination link(s) on the listing page');
    expect(outcome.evidence).toMatchObject({
      url: listing,
      status: 200,
      product_links: 3,
      pagination_links: 3,
      rel_next: false,
      load_more_controls: [],
    });
  });

  it('passes on rel=next and on a single page without any pagination', async () => {
    const next = await run({
      [listing]: html(products(2), '<link rel="next" href="/shop/page/2/">'),
    });
    expect(next.verdict).toBe('pass');
    expect(next.message).toMatch(/plus rel=next/);
    expect(next.evidence).toMatchObject({ rel_next: true, pagination_links: 0 });
    const single = await run({ [listing]: html(products(2)) });
    expect(single.verdict).toBe('pass');
    expect(single.message).toBe('2 product link(s) on the listing page and no pagination');
  });

  it('warns when more products come only from a load-more button or infinite scroll', async () => {
    const button = await run({
      [listing]: html(`${products(2)}<button class="btn">Load more</button>`),
    });
    expect(button.verdict).toBe('warn');
    expect(button.message).toMatch(/button or infinite scroll/);
    expect(button.evidence).toMatchObject({ load_more_controls: ['Load more'] });
    const scroll = await run({
      [listing]: html(`${products(2)}<a href="#" class="infinite-scroll-trigger">Weiter</a>`),
    });
    expect(scroll.verdict).toBe('warn');
    expect(scroll.evidence).toMatchObject({ load_more_controls: ['Weiter'] });
    const linked = await run({
      [listing]: html(
        `${products(2)}<button class="load-more">Mehr laden</button><a href="/shop/page/2/">2</a>`,
      ),
    });
    expect(linked.verdict).toBe('pass');
    expect(linked.evidence).toMatchObject({ load_more_controls: ['Mehr laden'] });
  });

  it('warns when the server-rendered HTML holds no product link', async () => {
    const outcome = await run({
      [listing]: html('<div id="app"></div><a href="/shop/page/2/">2</a>'),
    });
    expect(outcome.verdict).toBe('warn');
    expect(outcome.message).toMatch(/no product link is in the server-rendered HTML/);
    expect(outcome.evidence).toMatchObject({ product_links: 0, pagination_links: 1 });
  });

  it('warns when the listing page answers an error or nothing at all', async () => {
    const error = await run({ [listing]: { status: 503, body: 'down' } });
    expect(error.verdict).toBe('warn');
    expect(error.message).toBe('the listing page answered HTTP 503');
    const missing = await run({});
    expect(missing.verdict).toBe('warn');
    expect(missing.message).toBe('the listing page answered HTTP 404');
    const dead = await run({ [listing]: { status: 0 } });
    expect(dead.verdict).toBe('warn');
    expect(dead.message).toMatch(/could not be fetched/);
    expect(dead.evidence).toMatchObject({ status: 0 });
  });
});

describe('A1 checks on the good WooCommerce fixture', () => {
  const fixture = join(
    dirname(fileURLToPath(import.meta.url)),
    '..',
    '..',
    '..',
    '..',
    '..',
    'fixtures',
    'stores',
    'good-woocommerce',
  );

  it('passes A1.4 and A1.7', async () => {
    const fetcher = fixtureFetcher(fixture);
    const target = await resolveTarget('ceramics.example', fetcher);
    expect(target.sitemap?.lastmods).toEqual([
      '2026-10-01T09:00:00+00:00',
      '2026-10-02T09:00:00+00:00',
    ]);
    for (const check of [linkResponseHeaders, sitemapLastmodPlausible]) {
      const outcome = await runCheck(check, target, fetcher);
      expect(outcome.verdict, check.id).toBe('pass');
    }
  });
});
