import { describe, expect, it } from 'vitest';

import {
  isW3cDatetime,
  looksLikeProductSitemap,
  looksLikeProductUrl,
  parseSitemap,
} from './sitemap.js';

describe('parseSitemap', () => {
  it('parses an index', () => {
    const parsed = parseSitemap(
      '<?xml version="1.0"?><sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"><sitemap><loc>https://a.example/p.xml</loc></sitemap></sitemapindex>',
    );
    expect(parsed.kind).toBe('index');
    expect(parsed.sitemaps).toEqual(['https://a.example/p.xml']);
  });

  it('parses a urlset with one or many entries', () => {
    const one = parseSitemap('<urlset><url><loc>https://a.example/product/x/</loc></url></urlset>');
    expect(one.kind).toBe('urlset');
    expect(one.urls).toEqual(['https://a.example/product/x/']);
  });

  it('reports invalid documents', () => {
    expect(parseSitemap('<html><body>nope</body></html>').kind).toBe('invalid');
  });

  it('recognizes product URL shapes', () => {
    expect(looksLikeProductUrl('https://a.example/product/mug/')).toBe(true);
    expect(looksLikeProductUrl('https://a.example/products/mug')).toBe(true);
    expect(looksLikeProductUrl('https://a.example/about/')).toBe(false);
  });

  it('recognizes product sitemap file names but not look-alikes', () => {
    expect(looksLikeProductSitemap('https://a.example/product-sitemap.xml')).toBe(true);
    expect(looksLikeProductSitemap('https://a.example/wp-sitemap-posts-product-2.xml')).toBe(true);
    expect(looksLikeProductSitemap('https://a.example/sitemap_products_1.xml?from=1')).toBe(true);
    expect(looksLikeProductSitemap('https://a.example/product_update-sitemap.xml')).toBe(false);
    expect(looksLikeProductSitemap('https://a.example/page-sitemap.xml')).toBe(false);
    expect(looksLikeProductSitemap('https://a.example/products-sitemap.xml?page=2#top')).toBe(true);
    expect(looksLikeProductSitemap('https://a.example/product-sitemap.xml.bak')).toBe(false);
    expect(
      looksLikeProductSitemap(`https://a.example/productsitemap.xml?${'.xml?'.repeat(50_000)}`),
    ).toBe(true);
  });
});

describe('sitemap entries and lastmod', () => {
  it('returns entries with their lastmod next to the plain URL list', () => {
    const parsed = parseSitemap(
      '<urlset><url><loc>https://a.example/product/x/</loc><lastmod>2026-10-01</lastmod></url><url><loc>https://a.example/about/</loc></url></urlset>',
    );
    expect(parsed.entries).toEqual([
      { loc: 'https://a.example/product/x/', lastmod: '2026-10-01' },
      { loc: 'https://a.example/about/' },
    ]);
    expect(parsed.urls).toEqual(['https://a.example/product/x/', 'https://a.example/about/']);
    expect(parseSitemap('<sitemapindex></sitemapindex>').entries).toEqual([]);
  });

  it('accepts W3C datetimes with a day and a timezone, and rejects the rest', () => {
    for (const value of [
      '2026-10-01',
      '2026-10-01T09:00Z',
      '2026-10-01T09:00:00+00:00',
      '2026-10-01T09:00:00.123-05:30',
    ]) {
      expect(isW3cDatetime(value), value).toBe(true);
    }
    for (const value of [
      '',
      '2026',
      '2026-10',
      '2026-13-01',
      '2026-10-32',
      '2026-10-01T09:00:00',
      '2026-10-01T24:00:00Z',
      '2026-10-01 09:00:00',
      'Wed, 01 Oct 2026 09:00:00 GMT',
      '1759309200',
    ]) {
      expect(isW3cDatetime(value), value).toBe(false);
    }
  });
});
