import { describe, expect, it } from 'vitest';

import { FixtureFetcher } from './fixture-fetcher.js';

describe('FixtureFetcher conditional answers', () => {
  it('picks the answer whose request conditions match, falling back to the default', async () => {
    const fetcher = new FixtureFetcher({
      'https://shop.example/p/': [
        { status: 200, body: '<html>page</html>' },
        {
          status: 200,
          headers: { 'content-type': 'text/markdown' },
          body: '# page',
          when: { headers: { accept: 'text/markdown' } },
        },
        { status: 403, body: 'blocked', when: { headers: { 'user-agent': 'GPTBot' } } },
        { status: 204, when: { method: 'HEAD' } },
      ],
    });
    expect((await fetcher.fetch('https://shop.example/p/')).body).toBe('<html>page</html>');
    const markdown = await fetcher.fetch('https://shop.example/p/', {
      headers: { Accept: 'text/markdown, text/html;q=0.5' },
    });
    expect(markdown.body).toBe('# page');
    expect(markdown.headers['content-type']).toBe('text/markdown');
    expect(
      (await fetcher.fetch('https://shop.example/p/', { headers: { 'User-Agent': 'GPTBot/1.0' } }))
        .status,
    ).toBe(403);
    expect((await fetcher.fetch('https://shop.example/p/', { method: 'HEAD' })).status).toBe(204);
    expect((await fetcher.fetch('https://shop.example/missing')).status).toBe(404);
  });
});
