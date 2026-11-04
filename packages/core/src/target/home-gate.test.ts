import { describe, expect, it } from 'vitest';

import type { FetchedResponse } from '../http/types.js';
import { consentGatePath, detectHoldingPage, isCrossSiteRedirect, pageTitle } from './home-gate.js';

function page(url: string, body: string, extra: Partial<FetchedResponse> = {}): FetchedResponse {
  return {
    url,
    finalUrl: url,
    status: 200,
    headers: { 'content-type': 'text/html' },
    body,
    bytes: new TextEncoder().encode(body).byteLength,
    truncated: false,
    redirects: 0,
    durationMs: 1,
    fromCache: false,
    ...extra,
  };
}

const MAINTENANCE =
  '<!doctype html><html><head><title>Patagonia</title><style>body{font-family:sans-serif}</style></head><body><img src="/logo.svg" alt=""><h1>System maintenance is in progress</h1><p>We will be back shortly. Thank you for your patience.</p></body></html>';

describe('detectHoldingPage', () => {
  it('recognises a maintenance page that robots.txt answers with too', () => {
    const home = page('https://www.shop.example/', MAINTENANCE);
    const robots = page('https://www.shop.example/robots.txt', MAINTENANCE);
    expect(detectHoldingPage(home, robots)).toEqual({ label: 'Patagonia' });
  });

  it('recognises one by the shared title when the bodies differ in a token', () => {
    const home = page('https://www.shop.example/', MAINTENANCE.replace('shortly', 'soon'));
    const robots = page('https://www.shop.example/robots.txt', MAINTENANCE);
    expect(detectHoldingPage(home, robots)).not.toBeNull();
  });

  it('recognises an inert holding page without maintenance words', () => {
    const body =
      '<html><head><title>Shop</title></head><body><p>See you in spring.</p></body></html>';
    expect(
      detectHoldingPage(
        page('https://shop.example/', body),
        page('https://shop.example/robots.txt', body),
      ),
    ).toEqual({ label: 'Shop' });
  });

  it('does not take an HTML robots.txt that differs from the home page for a catch-all', () => {
    const home = page('https://shop.example/', MAINTENANCE);
    const robots = page(
      'https://shop.example/robots.txt',
      '<html><head><title>Page not found</title></head><body>Not here</body></html>',
    );
    expect(detectHoldingPage(home, robots)).toBeNull();
  });

  it('does not take a single-page app shell for a holding page', () => {
    const shell =
      '<!doctype html><html><head><title>Shop</title><script type="module" src="/assets/index.js"></script></head><body><div id="root"></div></body></html>';
    expect(
      detectHoldingPage(
        page('https://shop.example/', shell),
        page('https://shop.example/robots.txt', shell),
      ),
    ).toBeNull();
  });

  it('does not take a full home page that a catch-all route serves for robots.txt', () => {
    const nav = Array.from({ length: 400 }, (_, i) => `<a href="/p/${i}">Product ${i}</a>`).join(
      '',
    );
    const full = `<html><head><title>Shop</title></head><body>${nav}<p>Bike maintenance kits</p></body></html>`;
    expect(
      detectHoldingPage(
        page('https://shop.example/', full),
        page('https://shop.example/robots.txt', full),
      ),
    ).toBeNull();
  });

  it('ignores a text robots.txt and an unsuccessful one', () => {
    const home = page('https://shop.example/', MAINTENANCE);
    expect(
      detectHoldingPage(home, page('https://shop.example/robots.txt', 'User-agent: *\nAllow: /\n')),
    ).toBeNull();
    expect(
      detectHoldingPage(
        home,
        page('https://shop.example/robots.txt', MAINTENANCE, { status: 404 }),
      ),
    ).toBeNull();
  });
});

describe('isCrossSiteRedirect', () => {
  it('keeps www and apex, http and https, and subdomains on the same site', () => {
    const input = new URL('http://shop.example/');
    expect(isCrossSiteRedirect(input, 'https://www.shop.example/')).toBe(false);
    expect(isCrossSiteRedirect(input, 'https://eu.shop.example/de/')).toBe(false);
    expect(isCrossSiteRedirect(new URL('https://brand.co.uk/'), 'https://www.brand.co.uk/')).toBe(
      false,
    );
  });

  it('flags another registrable domain, two-part public suffixes included', () => {
    expect(
      isCrossSiteRedirect(new URL('https://brand.example/'), 'https://parent.example/brand'),
    ).toBe(true);
    expect(isCrossSiteRedirect(new URL('https://brand.co.uk/'), 'https://other.co.uk/')).toBe(true);
    expect(isCrossSiteRedirect(new URL('https://brand.com.au/'), 'https://brand.com/')).toBe(true);
  });
});

describe('consentGatePath', () => {
  const input = new URL('https://shop.example/');
  const redirected = (finalUrl: string) =>
    page('https://shop.example/', '<html></html>', { finalUrl, redirects: 1 });

  it('names consent, cookie and region gates the home page redirected to', () => {
    for (const path of [
      '/consent',
      '/cookies/',
      '/privacy-gate?return=/',
      '/en/region-select',
      '/choose-country.html',
      '/select-country',
    ]) {
      expect(consentGatePath(redirected(`https://shop.example${path}`), input)).not.toBeNull();
    }
  });

  it('leaves locale landings and ordinary redirects alone', () => {
    for (const path of ['/en-us/', '/de/home', '/cookie-cutters/', '/shop/']) {
      expect(consentGatePath(redirected(`https://shop.example${path}`), input)).toBeNull();
    }
    expect(
      consentGatePath(
        page('https://shop.example/consent', '<html></html>'),
        new URL('https://shop.example/consent'),
      ),
    ).toBeNull();
  });
});

describe('pageTitle', () => {
  it('collapses whitespace and is empty without a title', () => {
    expect(pageTitle('<title>\n  Shop\n  Home </title>')).toBe('Shop Home');
    expect(pageTitle('<html></html>')).toBe('');
  });
});
