import { catalog } from '@agentic-readiness/catalog';
import { knowledge } from '@agentic-readiness/catalog/knowledge';
import { describe, expect, it } from 'vitest';

import { createApp } from '../app.js';
import { configFromEnv } from '../config.js';
import { MemoryResultStore } from '../store/memory.js';
import { faqPairs, markdownToHtml, renderInline } from './markdown.js';
import { articlePath, gateOf, groupSlug } from './pages.js';

function testApp() {
  const config = configFromEnv({ APP_BASE_URL: 'https://scanner.example' });
  return createApp({ config, store: new MemoryResultStore() });
}

function ldGraph(html: string): Record<string, unknown>[] {
  const match = /<script type="application\/ld\+json">([\s\S]*?)<\/script>/.exec(html);
  expect(match).not.toBeNull();
  return (JSON.parse(match?.[1] ?? '{}') as { '@graph': Record<string, unknown>[] })['@graph'];
}

describe('knowledge Markdown renderer', () => {
  it('escapes HTML and refuses unsafe links', () => {
    expect(renderInline('<script>x</script> & **bold**')).toBe(
      '&lt;script&gt;x&lt;/script&gt; &amp; <strong class="font-semibold text-foreground">bold</strong>',
    );
    expect(renderInline('[click](javascript:alert(1))')).not.toContain('href');
    expect(renderInline('[spec](https://example.com/a?b=1&c=2)')).toContain(
      'href="https://example.com/a?b=1&amp;c=2" rel="noopener"',
    );
    expect(renderInline('`<b>**not bold**</b>`')).toContain('&lt;b&gt;**not bold**&lt;/b&gt;');
  });

  it('renders headings with anchors, lists, tables and code', () => {
    const { html, headings } = markdownToHtml(
      '## In short\n\nOne.\n\n- a\n- b\n\n1. first\n\n| A | B |\n| --- | --- |\n| x | `y` |\n\n```bash\ncurl -s "a<b"\n```',
    );
    expect(headings).toEqual([{ level: 2, text: 'In short', id: 'in-short' }]);
    expect(html).toContain('<h2 id="in-short"');
    expect(html).toContain('<ul class="mt-4 list-disc');
    expect(html).toContain('<ol class="mt-4 list-decimal');
    expect(html).toContain('<th class="px-3 py-2 font-semibold text-foreground">A</th>');
    expect(html).toContain('curl -s &quot;a&lt;b&quot;');
  });

  it('reads FAQ pairs as plain text', () => {
    expect(faqPairs('## FAQ\n\n### Why?\n\nBecause **it** [is](https://x.example).\n')).toEqual([
      { question: 'Why?', answer: 'Because it is.' },
    ]);
  });
});

describe('knowledge base', () => {
  it('has one article per check, each a level-aware page with structured data', async () => {
    const app = testApp();
    expect(knowledge.map((article) => article.id)).toEqual(catalog.checks.map((check) => check.id));
    for (const article of knowledge) {
      const response = await app.request(articlePath(article));
      expect(response.status, article.id).toBe(200);
      const html = await response.text();
      expect(html, article.id).toContain(
        `<link rel="canonical" href="https://scanner.example${articlePath(article)}">`,
      );
      const body = html.slice(html.indexOf('<article'), html.indexOf('</article>'));
      // No Markdown syntax survives rendering outside code.
      const prose = body.replace(/<pre[\s\S]*?<\/pre>|<code[\s\S]*?<\/code>/g, '');
      expect(prose, article.id).not.toMatch(/\*\*|\]\(|^#{2,3} /m);
      const graph = ldGraph(html);
      expect(graph.map((node) => node['@type'])).toEqual(
        expect.arrayContaining([
          'TechArticle',
          'FAQPage',
          'BreadcrumbList',
          'WebPage',
          'WebSite',
          'WebApplication',
          'Person',
          'ImageObject',
        ]),
      );
      const faq = graph.find((node) => node['@type'] === 'FAQPage') as { mainEntity: unknown[] };
      expect(faq.mainEntity.length, article.id).toBeGreaterThanOrEqual(3);
      expect(html).toContain('The fix in one step');
    }
  });

  it('says which level a gate check unlocks', async () => {
    expect(gateOf('A2.2')).toMatchObject({ value: 1, alternatives: [] });
    expect(gateOf('B5.8')).toMatchObject({ value: 2 });
    expect(gateOf('A1.4')).toBeNull();
    const html = await (
      await testApp().request('/knowledge-base/search-and-assistant-crawlers-allowed')
    ).text();
    expect(html).toContain('Required from Level 1 (Crawlable) upward.');
  });

  it('serves Markdown by suffix and by Accept, and redirects check ids', async () => {
    const app = testApp();
    const path = '/knowledge-base/search-and-assistant-crawlers-allowed';
    const md = await app.request(`${path}.md`);
    expect(md.headers.get('content-type')).toContain('text/markdown');
    const text = await md.text();
    expect(text).toMatch(
      /^---\ntitle: "Let the crawlers behind AI answers read your product pages"\n/,
    );
    expect(text).toContain(
      'canonical_url: https://scanner.example/knowledge-base/search-and-assistant-crawlers-allowed',
    );
    expect(text).toContain('level_gate: 1');
    expect(text).toContain('\n# Let the crawlers behind AI answers read your product pages\n');
    expect(md.headers.get('link')).toBe(
      '<https://scanner.example/knowledge-base/search-and-assistant-crawlers-allowed>; rel="canonical"; type="text/html"',
    );
    expect(text).toContain('## The fix in one step');
    expect(text).toContain('](https://scanner.example/knowledge-base/');
    const negotiated = await app.request(path, { headers: { accept: 'text/markdown' } });
    expect(negotiated.headers.get('content-type')).toContain('text/markdown');
    expect(negotiated.headers.get('vary')).toBe('Accept');
    const byId = await app.request('/knowledge-base/a2.2');
    expect(byId.status).toBe(301);
    expect(byId.headers.get('location')).toBe(path);
    expect((await app.request('/knowledge-base/A2.2.md')).headers.get('location')).toBe(
      `${path}.md`,
    );
    expect((await app.request('/knowledge-base/nothing-here')).status).toBe(404);
  });

  it('lists every article on the index, the section pages, the sitemap and llms.txt', async () => {
    const app = testApp();
    const index = await (await app.request('/knowledge-base')).text();
    const sitemap = await (await app.request('/sitemap.xml')).text();
    const llms = await (await app.request('/llms.txt')).text();
    const full = await (await app.request('/llms-full.txt')).text();
    for (const article of knowledge) {
      expect(index).toContain(`href="${articlePath(article)}"`);
      expect(sitemap).toContain(`<loc>https://scanner.example${articlePath(article)}</loc>`);
      expect(llms).toContain(`https://scanner.example${articlePath(article)}.md`);
      expect(full).toContain(`# ${article.headline}`);
    }
    for (const group of catalog.groups) {
      const response = await app.request(`/knowledge-base/${groupSlug(group)}`);
      expect(response.status, group.id).toBe(200);
      expect(index).toContain(`href="/knowledge-base/${groupSlug(group)}"`);
    }
    expect(await (await app.request('/robots.txt')).text()).toMatch(
      /^Sitemap: https:\/\/scanner\.example\/sitemap\.xml/,
    );
  });

  it('links the home page cards to their section and carries the new footer', async () => {
    const home = await (await testApp().request('/')).text();
    for (const group of catalog.groups)
      expect(home).toContain(`href="/knowledge-base/${groupSlug(group)}"`);
    expect(home).toContain(
      'An experiment by <a href="https://matthiasreinholz.com/about/" rel="author">Matthias Reinholz</a>',
    );
    expect(home).not.toContain('Automattic');
    expect(home).not.toContain('open data');
    expect(home).not.toContain('Nothing requires credentials');
    expect(home).toContain('at most once every 5 minutes');
  });

  it('keeps the old /knowledge links working', async () => {
    const app = testApp();
    for (const [from, to] of [
      ['/knowledge', '/knowledge-base'],
      ['/knowledge.md', '/knowledge-base.md'],
      ['/knowledge/gtin-valid', '/knowledge-base/gtin-valid'],
      ['/knowledge/A2.2', '/knowledge-base/A2.2'],
    ]) {
      const response = await app.request(from ?? '');
      expect(response.status, from).toBe(301);
      expect(response.headers.get('location'), from).toBe(to);
    }
  });

  it('gives agents a JSON index, section Markdown and alternate links', async () => {
    const app = testApp();
    const index = (await (await app.request('/knowledge-base.json')).json()) as {
      sections: {
        id: string;
        checks: { id: string; url: string; markdown_url: string; level_gate: unknown }[];
      }[];
    };
    const checks = index.sections.flatMap((section) => section.checks);
    expect(checks).toHaveLength(catalog.checks.length);
    expect(checks.find((check) => check.id === 'A2.2')).toMatchObject({
      url: 'https://scanner.example/knowledge-base/search-and-assistant-crawlers-allowed',
      level_gate: { level: 1, alternatives: [] },
    });
    const group = await app.request('/knowledge-base/bot-access-control.md');
    expect(group.headers.get('content-type')).toContain('text/markdown');
    expect(await group.text()).toContain('# A2 Bot access control');
    const html = await app.request('/knowledge-base/bot-access-control');
    expect(html.headers.get('link')).toContain(
      '<https://scanner.example/knowledge-base/bot-access-control.md>; rel="alternate"; type="text/markdown"',
    );
  });

  it('marks where the reader is: journey step, check cell and sidebar entry', async () => {
    const html = await (
      await testApp().request('/knowledge-base/search-and-assistant-crawlers-allowed')
    ).text();
    expect(html).toMatch(/title="A2 Bot access control" aria-current="step"/);
    expect(html).toContain('data-state="current"');
    expect(html.match(/data-state="group"/g)).toHaveLength(6);
    expect(html).toContain('Check 2 of 7 in Bot access control · 10 of 64 overall');
    expect(html).toContain('<section aria-labelledby="in-short">');
    expect(html).toContain('class="kb-progress"');
  });
});
