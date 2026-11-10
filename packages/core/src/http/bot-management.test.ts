import { describe, expect, it } from 'vitest';

import { cloudflareManagedRobots, edgeSignals, edgeVendors } from './bot-management.js';
import type { FetchedResponse } from './types.js';

function response(headers: Record<string, string>): FetchedResponse {
  return {
    url: 'https://shop.example/',
    finalUrl: 'https://shop.example/',
    status: 200,
    headers,
    body: '',
    bytes: 0,
    truncated: false,
    redirects: 0,
    durationMs: 0,
    fromCache: false,
  };
}

describe('edgeVendors', () => {
  it('recognises each vendor by its own header', () => {
    expect(edgeVendors(response({ 'set-cookie': '__cf_bm=abc; path=/; HttpOnly' }))).toEqual([
      'cloudflare',
    ]);
    expect(
      edgeVendors(response({ 'report-to': '{"endpoints":[{"url":"https://a.nel.cloudflare.com/report"}]}' })),
    ).toEqual(['cloudflare']);
    expect(edgeVendors(response({ 'x-vercel-id': 'fra1::x' }))).toEqual(['vercel']);
    expect(edgeVendors(response({ 'x-amz-cf-id': 'abc' }))).toEqual(['aws']);
    expect(edgeVendors(response({ server: 'AkamaiGHost' }))).toEqual(['akamai']);
    expect(edgeVendors(response({ 'x-served-by': 'cache-fra-1' }))).toEqual(['fastly']);
    expect(edgeVendors(response({ 'x-iinfo': '1-2-3' }))).toEqual(['imperva']);
  });

  it('lists a bot manager before the CDN it runs on, and nothing without a sign', () => {
    expect(edgeVendors(response({ 'x-datadome': 'protected', 'cf-mitigated': 'challenge' }))).toEqual([
      'datadome',
      'cloudflare',
    ]);
    expect(edgeVendors(response({ server: 'nginx', via: '1.1 proxy' }))).toEqual([]);
  });

  it('ignores cf-ray and server: cloudflare, which the hosted scanner's own network adds', () => {
    expect(edgeVendors(response({ server: 'cloudflare', 'cf-ray': '8f-FRA' }))).toEqual([]);
  });
});

describe('edgeSignals', () => {
  it('records the header that showed each vendor', () => {
    expect(edgeSignals(response({ server: 'Vercel', 'x-vercel-id': 'fra1::x' }))).toEqual([
      { id: 'vercel', header: 'x-vercel-id: fra1::x' },
    ]);
  });
});

describe('cloudflareManagedRobots', () => {
  it('returns the managed block between the markers, whatever their case', () => {
    const body =
      '# BEGIN Cloudflare Managed content\nUser-agent: GPTBot\nDisallow: /\n# END Cloudflare Managed Content\nUser-agent: *\nAllow: /\n';
    expect(cloudflareManagedRobots(body)).toBe('\nUser-agent: GPTBot\nDisallow: /\n');
    expect(cloudflareManagedRobots('User-agent: *\nAllow: /\n')).toBeNull();
  });
});
