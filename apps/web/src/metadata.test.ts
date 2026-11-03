import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

import type { ScanResult } from '@agentic-readiness/catalog';
import { isAllowed, parseRobotsTxt, scan, scanHead } from '@agentic-readiness/core';
import { fixtureFetcher } from '@agentic-readiness/core/testing';
import { SOCIAL_IMAGES, SOCIAL_IMAGE_HEIGHT, SOCIAL_IMAGE_WIDTH } from '@agentic-readiness/ui';
import { beforeAll, describe, expect, it } from 'vitest';

import { createApp } from './app.js';
import { configFromEnv } from './config.js';
import { jsonLd, reportMetadata, type SchemaNode } from './metadata.js';
import { MemoryResultStore } from './store/memory.js';
import type { StoredScan } from './store/types.js';

const config = configFromEnv({ APP_BASE_URL: 'https://scanner.example' });
const id = '0123456789abcdef';
let result: ScanResult;

beforeAll(async () => {
  result = await scan('https://ceramics.example/', {
    fetcher: fixtureFetcher(
      fileURLToPath(new URL('../../../fixtures/stores/good-woocommerce', import.meta.url)),
    ),
    now: () => new Date('2026-11-02T12:00:00Z'),
  });
});

function graphOf(html: string): SchemaNode[] {
  const scripts = [...html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)];
  expect(scripts).toHaveLength(1);
  const data = JSON.parse(scripts[0]?.[1] ?? '{}') as {
    '@context': string;
    '@graph': SchemaNode[];
  };
  expect(data['@context']).toBe('https://schema.org');
  return data['@graph'];
}

function storedScan(scanResult = result): StoredScan {
  return { id, host: 'ceramics.example', createdAt: scanResult.scanned_at, result: scanResult };
}

describe('server-rendered discovery and sharing metadata', () => {
  it.each([
    ['/', 'home', 'WebPage'],
    ['/knowledge-base', 'knowledge', 'CollectionPage'],
    ['/knowledge-base/bot-access-control', 'knowledge', 'CollectionPage'],
    ['/knowledge-base/search-and-assistant-crawlers-allowed', 'knowledge', 'TechArticle'],
  ] as const)(
    'serves complete, unique metadata on %s without running JavaScript',
    async (path, image, type) => {
      const app = createApp({ config, store: new MemoryResultStore() });
      const response = await app.request(path);
      expect(response.status).toBe(200);
      const html = await response.text();
      const head = html.slice(0, html.indexOf('</head>'));
      const url = `${config.baseUrl}${path}`;
      expect(head.match(/rel="canonical"/g)).toHaveLength(1);
      expect(head).toContain(`<link rel="canonical" href="${url}">`);
      expect(head.match(/property="og:title"/g)).toHaveLength(1);
      expect(head).toContain(`<meta property="og:url" content="${url}">`);
      expect(head).toContain(
        `<meta property="og:image" content="${config.baseUrl}${SOCIAL_IMAGES[image].path}">`,
      );
      expect(head).toContain('<meta property="og:image:type" content="image/png">');
      expect(head).toContain('<meta property="og:image:width" content="1200">');
      expect(head).toContain('<meta property="og:image:height" content="630">');
      expect(head).toContain('<meta property="og:image:alt"');
      expect(head).toContain('<meta name="twitter:card" content="summary_large_image">');
      expect(head).toContain('<meta name="twitter:image:alt"');
      expect(head).toContain(
        '<meta name="robots" content="index, follow, max-image-preview:large">',
      );
      expect(scanHead(html)).toMatchObject({ invalidHeadElement: null, misplaced: [] });
      const graph = graphOf(html);
      expect(graph.map((node) => node['@type'])).toContain(type);
      expect(graph.find((node) => node['@type'] === 'WebSite')).toMatchObject({
        '@id': `${config.baseUrl}/#website`,
        url: `${config.baseUrl}/`,
      });
      expect(graph.find((node) => node['@type'] === 'WebApplication')).toMatchObject({
        '@id': `${config.baseUrl}/#application`,
        isAccessibleForFree: true,
      });
      expect(graph.find((node) => node['@type'] === 'ImageObject')).toMatchObject({
        width: SOCIAL_IMAGE_WIDTH,
        height: SOCIAL_IMAGE_HEIGHT,
        encodingFormat: 'image/png',
      });
      expect(new Set(graph.map((node) => node['@id'])).size).toBe(graph.length);
      expect(JSON.stringify(graph)).not.toMatch(/AggregateRating|ReviewAction|BuyAction/);
    },
  );

  it('connects the homepage to the app and the article to its page, author, FAQ and section', async () => {
    const app = createApp({ config, store: new MemoryResultStore() });
    const home = graphOf(await (await app.request('/')).text());
    expect(home.find((node) => node['@type'] === 'WebPage')).toMatchObject({
      mainEntity: { '@id': `${config.baseUrl}/#application` },
    });
    const path = '/knowledge-base/search-and-assistant-crawlers-allowed';
    const graph = graphOf(await (await app.request(path)).text());
    const article = graph.find((node) => node['@type'] === 'TechArticle');
    expect(article).toMatchObject({
      identifier: 'A2.2',
      mainEntityOfPage: { '@id': `${config.baseUrl}${path}#webpage` },
      isPartOf: { '@id': `${config.baseUrl}/knowledge-base#webpage` },
    });
    expect(article?.author).toEqual({
      '@id': graph.find((node) => node['@type'] === 'Person')?.['@id'],
    });
    expect(graph.find((node) => node['@type'] === 'FAQPage')).toMatchObject({
      isPartOf: { '@id': `${config.baseUrl}${path}#webpage` },
    });
    expect(graph.find((node) => node['@type'] === 'BreadcrumbList')).toBeDefined();
  });

  it('keeps JSON-LD and attributes safe with HTML delimiters and Unicode separators', async () => {
    const hostile = '</script><script>alert("x")</script>&\u2028\u2029';
    const serialized = jsonLd({ name: hostile });
    expect(serialized.match(/<\/script>/g)).toHaveLength(1);
    expect(
      JSON.parse(
        serialized.slice(serialized.indexOf('>') + 1, serialized.lastIndexOf('</script>')),
      ),
    ).toEqual({
      name: hostile,
    });
    const app = createApp({
      config: { ...config, appName: hostile },
      store: new MemoryResultStore(),
    });
    const html = await (await app.request('/')).text();
    expect(html).not.toContain('<script>alert');
    expect(graphOf(html).find((node) => node['@type'] === 'WebSite')?.name).toBe(hostile);
    expect(html).toContain('&lt;/script&gt;');
  });

  it('renders indexable reports from stored scores with alternate machine formats', async () => {
    const store = new MemoryResultStore();
    await store.put(storedScan());
    const app = createApp({ config, store });
    const url = `${config.baseUrl}/r/${id}`;
    const response = await app.request(`/r/${id}`);
    expect(response.headers.get('x-robots-tag')).toBe('index, follow, max-image-preview:large');
    expect(response.headers.get('vary')).toBe('Accept');
    expect(response.headers.get('link')).toContain(`<${url}>; rel="canonical"`);
    const html = await response.text();
    expect(html).toContain(`<link rel="canonical" href="${url}">`);
    expect(html).toContain('<title>Agentic readiness report for ceramics.example</title>');
    const graph = graphOf(html);
    expect(graph.find((node) => node['@type'] === 'Report')).toMatchObject({
      '@id': `${url}#report`,
      reportNumber: id,
      datePublished: result.scanned_at,
      about: { url: 'https://ceramics.example', name: 'ceramics.example' },
      isBasedOn: { '@id': `${url}#scan-data` },
    });
    const dataset = graph.find((node) => node['@type'] === 'Dataset');
    expect(dataset?.variableMeasured).toEqual(
      expect.arrayContaining([
        {
          '@type': 'PropertyValue',
          name: 'Agentic ingestion score',
          value: result.scores.ingestion,
          minValue: 0,
          maxValue: 100,
        },
        {
          '@type': 'PropertyValue',
          name: 'Agentic commerce score',
          value: result.scores.commerce,
          minValue: 0,
          maxValue: 100,
        },
      ]),
    );
    expect(dataset).toMatchObject({
      distribution: [
        { '@type': 'DataDownload', encodingFormat: 'application/json', contentUrl: `${url}.json` },
      ],
    });
    for (const [path, accept, mime] of [
      [`/r/${id}.json`, 'application/json', 'application/json'],
      [`/r/${id}.md`, 'text/markdown', 'text/markdown'],
      [`/r/${id}`, 'text/markdown', 'text/markdown'],
    ]) {
      const alternate = await app.request(path ?? '', { headers: { accept: accept ?? '' } });
      expect(alternate.headers.get('content-type')).toContain(mime);
      expect(alternate.headers.get('x-robots-tag')).toBe('noindex, follow');
      expect(alternate.headers.get('link')).toContain(`<${url}>; rel="canonical"`);
      expect(alternate.headers.get('vary')).toBe('Accept');
    }
    await store.deleteOlderThan('2099-01-01T00:00:00Z');
    const expired = await app.request(`/r/${id}`);
    expect(expired.status).toBe(404);
    expect(await expired.text()).not.toContain('application/ld+json');
    expect(expired.headers.get('x-robots-tag')).toBeNull();
  });

  it('omits an unscored commerce measurement and sensitive URL parts from metadata', () => {
    const copy = structuredClone(result);
    copy.scores.commerce = null;
    copy.target.url = 'https://ceramics.example/private-path?token=private-token#private-fragment';
    const metadata = reportMetadata(config, storedScan(copy));
    expect(metadata.description).toContain('commerce not applicable');
    expect(metadata.description).toContain('checkout not verified');
    expect(metadata.head).not.toMatch(/private-path|private-token|private-fragment/);
    const dataset = graphOf(metadata.head).find((node) => node['@type'] === 'Dataset');
    expect(dataset?.variableMeasured).toHaveLength(2);
    expect(dataset?.variableMeasured).not.toEqual(
      expect.arrayContaining([expect.objectContaining({ name: 'Agentic commerce score' })]),
    );
  });

  it('allows reports and images for search, assistant and social crawlers while retaining scoped restrictions', async () => {
    const app = createApp({ config, store: new MemoryResultStore() });
    const robots = parseRobotsTxt(await (await app.request('/robots.txt')).text());
    for (const token of [
      'Googlebot',
      'Bingbot',
      'OAI-SearchBot',
      'ChatGPT-User',
      'facebookexternalhit',
      'Twitterbot',
    ]) {
      for (const path of [
        '/r/0123456789abcdef',
        '/r/0123456789abcdef.json',
        '/social/report-v1.png',
        '/knowledge-base',
      ]) {
        expect(isAllowed(robots, token, path), `${token} ${path}`).toBe(true);
      }
      for (const path of ['/h/shop.example', '/api/scan', '/internal/export', '/monitor/confirm']) {
        expect(isAllowed(robots, token, path), `${token} ${path}`).toBe(false);
      }
    }
    expect(isAllowed(robots, 'GPTBot', `/r/${id}`)).toBe(false);
    expect(isAllowed(robots, 'GPTBot', '/knowledge-base')).toBe(true);
    expect(await (await app.request('/sitemap.xml')).text()).not.toContain('/r/');
  });

  it('builds compact PNGs with the dimensions advertised in metadata', async () => {
    for (const card of Object.values(SOCIAL_IMAGES)) {
      const bytes = await readFile(new URL(`../dist${card.path}`, import.meta.url));
      expect(bytes.subarray(0, 8).toString('hex')).toBe('89504e470d0a1a0a');
      expect(bytes.subarray(12, 16).toString()).toBe('IHDR');
      expect(bytes.readUInt32BE(16)).toBe(SOCIAL_IMAGE_WIDTH);
      expect(bytes.readUInt32BE(20)).toBe(SOCIAL_IMAGE_HEIGHT);
      expect(bytes.length).toBeLessThan(1_000_000);
      expect(bytes.length).toBeGreaterThan(10_000);
    }
  });
});
