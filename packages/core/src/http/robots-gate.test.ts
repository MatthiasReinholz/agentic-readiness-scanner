import { describe, expect, it } from 'vitest';

import { parseRobotsTxt } from '../parsers/robots.js';
import { RobotsGatedFetcher, isRobotsExempt } from './robots-gate.js';
import type { FetchedResponse, Fetcher } from './types.js';

class CountingFetcher implements Fetcher {
  readonly urls: string[] = [];
  readonly budget = 40;
  get requestCount(): number {
    return this.urls.length;
  }
  fetch(url: string): Promise<FetchedResponse> {
    this.urls.push(url);
    return Promise.resolve({
      url,
      finalUrl: url,
      status: 200,
      headers: {},
      body: 'ok',
      bytes: 2,
      truncated: false,
      redirects: 0,
      durationMs: 1,
      fromCache: false,
    });
  }
}

const ROBOTS = `User-agent: *
Allow: /

User-agent: AgenticReadinessScanner
Disallow: /private/
Disallow: /*.pdf$
Allow: /private/open/
`;

describe('RobotsGatedFetcher', () => {
  it('lets everything through until robots.txt is known, then honours the scanner group', async () => {
    const inner = new CountingFetcher();
    const gate = new RobotsGatedFetcher(inner);
    await gate.fetch('https://shop.example/private/x');
    gate.setRobots(parseRobotsTxt(ROBOTS));
    const blocked = await gate.fetch('https://shop.example/private/x');
    expect(blocked.status).toBe(0);
    expect(blocked.error).toBe(
      'not fetched: robots.txt disallows /private/x for AgenticReadinessScanner',
    );
    const withQuery = await gate.fetch('https://shop.example/private/x?view=json');
    expect(withQuery.error).toBe(
      'not fetched: robots.txt disallows /private/x?view=json for AgenticReadinessScanner',
    );
    const allowed = await gate.fetch('https://shop.example/private/open/y');
    expect(allowed.status).toBe(200);
    const pdf = await gate.fetch('https://shop.example/catalog.pdf');
    expect(pdf.status).toBe(0);
    expect(inner.urls).toEqual([
      'https://shop.example/private/x',
      'https://shop.example/private/open/y',
    ]);
    expect(gate.blocked).toEqual([
      'https://shop.example/private/x',
      'https://shop.example/private/x?view=json',
      'https://shop.example/catalog.pdf',
    ]);
    // A refusal is policy, not a failed request.
    expect(gate.failures).toEqual([]);
  });

  it('never blocks robots.txt, sitemaps or the well-known directory', async () => {
    const inner = new CountingFetcher();
    const gate = new RobotsGatedFetcher(inner);
    gate.setRobots(parseRobotsTxt('User-agent: *\nDisallow: /\n'));
    for (const path of [
      '/robots.txt',
      '/sitemap.xml',
      '/wp-sitemap-posts-product-1.xml',
      '/.well-known/security.txt',
    ]) {
      expect(isRobotsExempt(new URL(`https://shop.example${path}`))).toBe(true);
      expect((await gate.fetch(`https://shop.example${path}`)).status).toBe(200);
    }
    expect((await gate.fetch('https://shop.example/product/a')).status).toBe(0);
    expect((await gate.fetch('https://shop.example/llms.txt')).status).toBe(0);
  });
});
