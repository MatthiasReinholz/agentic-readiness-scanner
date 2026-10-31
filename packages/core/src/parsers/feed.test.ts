import { describe, expect, it } from 'vitest';

import {
  feedRejection,
  isProductFeed,
  parseDelimitedRows,
  parseFeed,
  robotsFeedHints,
  sniffFeedFormat,
} from './feed.js';

const GOOGLE_XML = `<?xml version="1.0"?>
<rss version="2.0" xmlns:g="http://base.google.com/ns/1.0">
  <channel>
    <title>Shop</title>
    <lastBuildDate>Fri, 30 Oct 2026 09:00:00 GMT</lastBuildDate>
    <item>
      <g:id>MUG-1</g:id>
      <g:title>Mug</g:title>
      <g:link>https://shop.example/product/mug/</g:link>
      <g:price>24.00 EUR</g:price>
      <g:availability>in_stock</g:availability>
    </item>
    <item>
      <g:id>BOWL-1</g:id>
      <g:title>Bowl</g:title>
      <g:price>48.00 EUR</g:price>
    </item>
  </channel>
</rss>`;

const BLOG_RSS = `<rss version="2.0"><channel><title>Blog</title><pubDate>Mon, 01 Jun 2026 10:00:00 GMT</pubDate><item><title>Post</title><link>https://shop.example/post/</link></item></channel></rss>`;

const ATOM = `<feed xmlns="http://www.w3.org/2005/Atom"><title>Atom</title><updated>2026-10-29T08:00:00Z</updated><entry><title type="text">Entry</title><id>1</id></entry></feed>`;

describe('sniffFeedFormat', () => {
  it('trusts a specific Content-Type', () => {
    expect(sniffFeedFormat('whatever', 'application/rss+xml; charset=utf-8')).toBe('xml');
    expect(sniffFeedFormat('whatever', 'text/csv')).toBe('csv');
    expect(sniffFeedFormat('whatever', 'text/tab-separated-values')).toBe('tsv');
    expect(sniffFeedFormat('whatever', 'application/x-ndjson')).toBe('jsonl');
  });

  it('falls back to the body shape', () => {
    expect(sniffFeedFormat('﻿<?xml version="1.0"?><rss/>', 'text/plain')).toBe('xml');
    expect(sniffFeedFormat('[{"id":1}]', 'application/octet-stream')).toBe('json');
    expect(sniffFeedFormat('{"items":[]}', '')).toBe('json');
    expect(sniffFeedFormat('{"id":1}\n{"id":2}\n', '')).toBe('jsonl');
    expect(sniffFeedFormat('id\ttitle\tlink\tprice\n1\tMug\thttps://x\t24.00 EUR', '')).toBe('tsv');
    expect(sniffFeedFormat('id,title,link,price\n1,Mug,https://x,24.00 EUR', 'text/plain')).toBe(
      'csv',
    );
    expect(sniffFeedFormat('hello world', 'text/plain')).toBe('unknown');
  });
});

describe('parseFeed on XML', () => {
  it('reads Google-namespaced RSS items and the build date', () => {
    const feed = parseFeed(GOOGLE_XML, 'application/xml');
    expect(feed.format).toBe('xml');
    expect(feed.namespaceGoogle).toBe(true);
    expect(feed.items).toHaveLength(2);
    expect(feed.items[0]).toMatchObject({ 'g:id': 'MUG-1', 'g:price': '24.00 EUR' });
    expect(feed.fields).toContain('g:availability');
    expect(feed.lastModifiedInFeed).toBe('Fri, 30 Oct 2026 09:00:00 GMT');
    expect(isProductFeed(feed)).toBe(true);
  });

  it('reads at most the requested number of items', () => {
    expect(parseFeed(GOOGLE_XML, 'application/xml', 1).items).toHaveLength(1);
  });

  it('qualifies RSS with g: items even without the namespace declaration', () => {
    const feed = parseFeed(
      '<rss><channel><item><g:id>1</g:id><g:price>1.00 EUR</g:price></item></channel></rss>',
    );
    expect(feed.namespaceGoogle).toBe(false);
    expect(isProductFeed(feed)).toBe(true);
  });

  it('rejects a blog feed but keeps its pubDate', () => {
    const feed = parseFeed(BLOG_RSS, 'application/rss+xml');
    expect(isProductFeed(feed)).toBe(false);
    expect(feed.lastModifiedInFeed).toBe('Mon, 01 Jun 2026 10:00:00 GMT');
    expect(feedRejection(feed)).toMatch(/Google Merchant namespace/);
  });

  it('reads Atom entries and updated, flattening typed text', () => {
    const feed = parseFeed(ATOM, 'application/atom+xml');
    expect(feed.items).toEqual([{ title: 'Entry', id: '1' }]);
    expect(feed.lastModifiedInFeed).toBe('2026-10-29T08:00:00Z');
    expect(isProductFeed(feed)).toBe(false);
  });

  it('reports malformed XML and an unrelated root instead of throwing', () => {
    expect(parseFeed('<rss><channel><item></rss>', 'text/xml').items).toEqual([]);
    const html = parseFeed('<html><body>nope</body></html>', 'text/xml');
    expect(html.error).toBe('no rss or feed root');
    expect(isProductFeed(html)).toBe(false);
  });
});

describe('parseFeed on CSV and TSV', () => {
  it('reads a header row and quoted fields', () => {
    const feed = parseFeed(
      'id,title,link,price,description\n1,"Mug, blue",https://shop.example/p/1,"24.00 EUR","Says ""hi""\nover two lines"\n2,Bowl,https://shop.example/p/2,48.00 EUR,\n',
      'text/csv',
    );
    expect(feed.format).toBe('csv');
    expect(feed.fields).toEqual(['id', 'title', 'link', 'price', 'description']);
    expect(feed.items).toHaveLength(2);
    expect(feed.items[0]).toMatchObject({
      title: 'Mug, blue',
      price: '24.00 EUR',
      description: 'Says "hi"\nover two lines',
    });
    expect(feed.items[1]).not.toHaveProperty('description');
    expect(isProductFeed(feed)).toBe(true);
  });

  it('accepts url in place of link and rejects a header without price', () => {
    expect(
      isProductFeed(parseFeed('ID\tTitle\tURL\tPrice\n1\tMug\thttps://x\t1', 'text/tsv')),
    ).toBe(true);
    const noPrice = parseFeed('id,title,link\n1,Mug,https://x', 'text/csv');
    expect(isProductFeed(noPrice)).toBe(false);
    expect(feedRejection(noPrice)).toBe('CSV header lacks id, title, link/url or price');
  });

  it('bounds the rows it reads', () => {
    const rows = parseDelimitedRows('a,b\n1,2\n3,4\n5,6\n', ',', 2);
    expect(rows).toEqual([
      ['a', 'b'],
      ['1', '2'],
    ]);
  });
});

describe('parseFeed on JSON', () => {
  const item = { id: 'MUG-1', title: 'Mug', url: 'https://shop.example/p/1', price: '24.00 EUR' };

  it('reads an array, an items or products object and a top-level timestamp', () => {
    expect(isProductFeed(parseFeed(JSON.stringify([item]), 'application/json'))).toBe(true);
    const wrapped = parseFeed(
      JSON.stringify({ updated_at: '2026-10-30T10:00:00Z', items: [item] }),
      'application/json',
    );
    expect(wrapped.items).toEqual([item]);
    expect(wrapped.lastModifiedInFeed).toBe('2026-10-30T10:00:00Z');
    expect(isProductFeed(wrapped)).toBe(true);
    expect(
      isProductFeed(
        parseFeed(JSON.stringify({ products: [{ ...item, url: undefined, link: 'x' }] })),
      ),
    ).toBe(true);
  });

  it('reads JSON Lines', () => {
    const feed = parseFeed(`${JSON.stringify(item)}\n${JSON.stringify({ ...item, id: '2' })}\n`);
    expect(feed.format).toBe('jsonl');
    expect(feed.items).toHaveLength(2);
    expect(isProductFeed(feed)).toBe(true);
  });

  it('flattens nested values to strings and bounds the item count', () => {
    const feed = parseFeed(
      JSON.stringify([{ ...item, price: 24, offers: { a: 1 } }, item, item]),
      '',
      2,
    );
    expect(feed.items).toHaveLength(2);
    expect(feed.items[0]).toMatchObject({ price: '24', offers: '{"a":1}' });
  });

  it('rejects invalid JSON, an unrelated object and items missing fields', () => {
    expect(parseFeed('{not json', 'application/json').error).toBe('invalid JSON');
    expect(parseFeed('{"total": 2}', 'application/json').error).toBe('no items or products array');
    const partial = parseFeed(JSON.stringify([{ id: 1, title: 'Mug' }]), 'application/json');
    expect(isProductFeed(partial)).toBe(false);
    expect(feedRejection(partial)).toBe('JSON items lack id, title, url/link or price');
  });
});

describe('robotsFeedHints', () => {
  it('returns feed URLs from Sitemap records and comments only', () => {
    const hints = robotsFeedHints(
      [
        '# Product feed: https://shop.example/feed/products.xml (hourly)',
        '# See https://shop.example/about/ for details',
        'Sitemap: https://shop.example/sitemap.xml',
        'Sitemap: https://shop.example/feed-sitemap.xml',
        'Disallow: /feed/private/',
        'Allow: https://shop.example/feed/',
      ].join('\n'),
    );
    expect(hints).toEqual([
      'https://shop.example/feed/products.xml',
      'https://shop.example/feed-sitemap.xml',
    ]);
  });
});
