import { describe, expect, it } from 'vitest';

import { hasLinkRelation, mediaTypeOf, parseLinkHeader } from './link-header.js';

describe('parseLinkHeader', () => {
  it('reads one value with rel, type and title parameters', () => {
    const [link] = parseLinkHeader(
      '</llms.txt>; rel="llms-txt"; type="text/markdown; charset=utf-8"; title="Index"',
    );
    expect(link).toMatchObject({
      href: '/llms.txt',
      rel: ['llms-txt'],
      type: 'text/markdown',
      title: 'Index',
    });
    expect(link?.params.rel).toBe('llms-txt');
  });

  it('splits several values on commas outside angle brackets and quotes', () => {
    const links = parseLinkHeader(
      '<https://a.example/x?a=1,2>; rel=preconnect, </api>; rel="service-desc describedby"; title="one, two", </rsl.xml>; rel=license; type=application/rsl+xml',
    );
    expect(links.map((link) => link.href)).toEqual([
      'https://a.example/x?a=1,2',
      '/api',
      '/rsl.xml',
    ]);
    expect(links[1]?.rel).toEqual(['service-desc', 'describedby']);
    expect(links[1]?.title).toBe('one, two');
    expect(links[2]).toMatchObject({ rel: ['license'], type: 'application/rsl+xml' });
  });

  it('lower-cases relation and type, keeps the first rel and unescapes quoted pairs', () => {
    const [link] = parseLinkHeader(
      '</a>; REL="Alternate"; rel="other"; Type="Text/Markdown"; title="say \\"hi\\""',
    );
    expect(link).toMatchObject({ rel: ['alternate'], type: 'text/markdown', title: 'say "hi"' });
    expect(hasLinkRelation(link ?? { href: '', rel: [], params: {} }, 'ALTERNATE')).toBe(true);
  });

  it('ignores values without angle brackets and empty, null or undefined headers', () => {
    expect(parseLinkHeader('rel=next, </ok>; rel=next')).toHaveLength(1);
    expect(parseLinkHeader('')).toEqual([]);
    expect(parseLinkHeader(null)).toEqual([]);
    expect(parseLinkHeader(undefined)).toEqual([]);
    expect(parseLinkHeader('<unterminated; rel=next')).toEqual([]);
  });

  it('stays linear on a long header full of separators', () => {
    const header = `<${'/a,;'.repeat(20_000)}>; rel=next`;
    const started = Date.now();
    const links = parseLinkHeader(header);
    expect(Date.now() - started).toBeLessThan(1000);
    expect(links.length).toBeLessThanOrEqual(1);
  });

  it('reduces a content-type or type value to its media type', () => {
    expect(mediaTypeOf('Text/Markdown; charset=utf-8')).toBe('text/markdown');
    expect(mediaTypeOf(undefined)).toBe('');
  });
});
