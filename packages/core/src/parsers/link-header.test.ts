import { describe, expect, it } from 'vitest';

import { linksWithRel, parseLinkHeader } from './link-header.js';

describe('parseLinkHeader', () => {
  it('reads several members with quoted and bare parameters', () => {
    const entries = parseLinkHeader(
      '</llms.txt>; rel="llms-txt"; type="text/markdown", <https://mcp.shop.example/mcp>; rel=mcp-server',
    );
    expect(entries).toEqual([
      {
        url: '/llms.txt',
        rel: 'llms-txt',
        params: { rel: 'llms-txt', type: 'text/markdown' },
      },
      { url: 'https://mcp.shop.example/mcp', rel: 'mcp-server', params: { rel: 'mcp-server' } },
    ]);
  });

  it('keeps commas and semicolons inside the URL or a quoted value', () => {
    const entries = parseLinkHeader('</a?x=1,2;3>; rel="next, prev"; title="a;b"');
    expect(entries).toEqual([
      { url: '/a?x=1,2;3', rel: 'next, prev', params: { rel: 'next, prev', title: 'a;b' } },
    ]);
  });

  it('skips malformed members and tolerates an empty header', () => {
    expect(parseLinkHeader(undefined)).toEqual([]);
    expect(parseLinkHeader('')).toEqual([]);
    expect(parseLinkHeader('rel="next", <>; rel=x, <https://shop.example/>; rel')).toEqual([
      { url: 'https://shop.example/', rel: '', params: { rel: '' } },
    ]);
  });

  it('matches one relation inside a space-separated rel list', () => {
    const entries = parseLinkHeader('</mcp>; rel="service mcp-server", </other>; rel=mcp');
    expect(linksWithRel(entries, 'MCP-Server').map((entry) => entry.url)).toEqual(['/mcp']);
    expect(linksWithRel(entries, 'service')).toHaveLength(1);
    expect(linksWithRel(entries, 'next')).toEqual([]);
  });
});
