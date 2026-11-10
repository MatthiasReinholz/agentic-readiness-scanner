/**
 * Routes for the knowledge base, the sitemap and llms-full.txt. Every page answers as
 * HTML, or as Markdown when the path ends in .md or the client sends Accept: text/markdown
 * first; the bare URL varies on Accept so caches keep the two apart.
 */
import { catalog } from '@agentic-readiness/catalog';
import { guides, knowledge } from '@agentic-readiness/catalog/knowledge';
import { Hono, type Context } from 'hono';

import type { AppConfig } from '../config.js';
import {
  articleByCheckId,
  articleBySlug,
  articleMarkdown,
  articlePath,
  crawlerRegistryMarkdown,
  crawlerRegistryPage,
  CRAWLERS_PATH,
  groupBySlug,
  groupSlug,
  knowledgeArticlePage,
  knowledgeFullMarkdown,
  knowledgeGroupPage,
  knowledgeIndexMarkdown,
  knowledgeIndexJson,
  groupMarkdown,
  guideBySlug,
  guideMarkdown,
  guidePage,
  guidePath,
  GUIDES_HUB_PATH,
  guidesHubMarkdown,
  guidesHubPage,
  knowledgeIndexPage,
  KNOWLEDGE_UPDATED,
  LEGAL_HUB_PATH,
  legalHubMarkdown,
  legalHubPage,
} from './pages.js';

const CACHE = 'public, max-age=3600';
const MARKDOWN = 'text/markdown; charset=utf-8';

function wantsMarkdown(c: Context): boolean {
  const accept = c.req.header('accept') ?? '';
  return /^\s*text\/markdown/i.test(accept);
}

function markdown(c: Context, body: string): Response {
  return c.body(body, 200, { 'content-type': MARKDOWN, 'cache-control': CACHE, vary: 'Accept' });
}

/** Lines for /llms.txt: every article with its Markdown URL. */
export function knowledgeIndexLines(config: AppConfig): string {
  return [
    `- [Knowledge base index](${config.baseUrl}/knowledge-base.md): every section and check in one list`,
    `- [Knowledge base as JSON](${config.baseUrl}/knowledge-base.json): sections, checks, priorities, level gates and URLs`,
    ...guides.map(
      (guide) =>
        `- [Guide: ${guide.headline}](${config.baseUrl}${guidePath(guide)}.md): ${guide.description}`,
    ),
    `- [AI crawler and agent registry](${config.baseUrl}${CRAWLERS_PATH}.md): every AI crawler, fetcher and browser agent the scanner reads robots.txt for, with its operator and documentation`,
    ...knowledge.map((article) => {
      return `- [${article.id} ${article.headline}](${config.baseUrl}${articlePath(article)}.md): ${article.description}`;
    }),
  ].join('\n');
}

function sitemapXml(config: AppConfig): string {
  const urls = [
    '/',
    '/data-processing',
    '/knowledge-base',
    ...catalog.groups.map((group) => `/knowledge-base/${groupSlug(group)}`),
    LEGAL_HUB_PATH,
    GUIDES_HUB_PATH,
    CRAWLERS_PATH,
    ...guides.map(guidePath),
    ...knowledge.map(articlePath),
  ];
  return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls.map((path) => `<url><loc>${config.baseUrl}${path}</loc>${path.startsWith('/knowledge-base') ? `<lastmod>${KNOWLEDGE_UPDATED}</lastmod>` : ''}</url>`).join('\n')}
</urlset>
`;
}

/** Link header pointing a page at its other representation, for agents that only send HEAD. */
function alternates(config: AppConfig, path: string, as: 'html' | 'markdown'): string {
  const url = `${config.baseUrl}${path}`;
  return as === 'html'
    ? `<${url}.md>; rel="alternate"; type="text/markdown", <${url}>; rel="canonical"`
    : `<${url}>; rel="canonical"; type="text/html"`;
}

/**
 * Slugs of articles whose check was removed, and where their readers go instead. B1.3
 * (Store API not rate-limited for reads) left in catalog 0.10.0: WooCommerce's limiter is
 * off by default and covers only POST requests, so reads never meet it.
 */
const RETIRED_ARTICLES: Record<string, string> = {
  'store-api-rate-limits': 'store-api-reachable',
};

export function createKnowledgeRoutes(config: AppConfig): Hono {
  const app = new Hono();

  const html = (c: Context, path: string, body: string): Response => {
    c.header('cache-control', CACHE);
    c.header('vary', 'Accept');
    c.header('link', alternates(config, path, 'html'));
    return c.html(body);
  };
  const md = (c: Context, path: string, body: string): Response => {
    c.header('link', alternates(config, path, 'markdown'));
    return markdown(c, body);
  };

  app.get('/sitemap.xml', (c) =>
    c.body(sitemapXml(config), 200, {
      'content-type': 'application/xml; charset=utf-8',
      'cache-control': CACHE,
    }),
  );

  app.get('/llms-full.txt', (c) => markdown(c, knowledgeFullMarkdown(config)));

  app.get('/knowledge-base.json', (c) =>
    c.json(knowledgeIndexJson(config), 200, {
      'cache-control': CACHE,
      'access-control-allow-origin': '*',
    }),
  );
  app.get('/knowledge-base.md', (c) => md(c, '/knowledge-base', knowledgeIndexMarkdown(config)));
  app.get('/knowledge-base/', (c) => c.redirect('/knowledge-base', 301));
  app.get('/knowledge-base', (c) =>
    wantsMarkdown(c)
      ? md(c, '/knowledge-base', knowledgeIndexMarkdown(config))
      : html(c, '/knowledge-base', knowledgeIndexPage(config)),
  );

  app.get(`${GUIDES_HUB_PATH}.md`, (c) => md(c, GUIDES_HUB_PATH, guidesHubMarkdown(config)));
  app.get(`${GUIDES_HUB_PATH}/`, (c) => c.redirect(GUIDES_HUB_PATH, 301));
  app.get(GUIDES_HUB_PATH, (c) =>
    wantsMarkdown(c)
      ? md(c, GUIDES_HUB_PATH, guidesHubMarkdown(config))
      : html(c, GUIDES_HUB_PATH, guidesHubPage(config)),
  );
  app.get(`${CRAWLERS_PATH}.md`, (c) => md(c, CRAWLERS_PATH, crawlerRegistryMarkdown(config)));
  app.get(`${CRAWLERS_PATH}/`, (c) => c.redirect(CRAWLERS_PATH, 301));
  app.get(CRAWLERS_PATH, (c) =>
    wantsMarkdown(c)
      ? md(c, CRAWLERS_PATH, crawlerRegistryMarkdown(config))
      : html(c, CRAWLERS_PATH, crawlerRegistryPage(config)),
  );
  app.get(`${GUIDES_HUB_PATH}/:file`, (c) => {
    const file = c.req.param('file');
    const asMarkdown = file.endsWith('.md');
    const guide = guideBySlug(asMarkdown ? file.slice(0, -3) : file);
    if (!guide) return c.notFound();
    const path = guidePath(guide);
    return asMarkdown || wantsMarkdown(c)
      ? md(c, path, guideMarkdown(config, guide))
      : html(c, path, guidePage(config, guide));
  });

  app.get('/knowledge-base/:file', (c) => {
    const file = c.req.param('file');
    const asMarkdown = file.endsWith('.md');
    const slug = asMarkdown ? file.slice(0, -3) : file;
    // A check id (/knowledge-base/A2.2) moves to its article, so reports and agents can link by id.
    if (/^[abc]\d\.\d+$/i.test(slug)) {
      const byId = articleByCheckId(slug);
      if (byId) return c.redirect(`${articlePath(byId)}${asMarkdown ? '.md' : ''}`, 301);
    }
    // An article whose check left the catalog moves to the closest one that remains.
    const replacement = RETIRED_ARTICLES[slug];
    if (replacement) {
      return c.redirect(`/knowledge-base/${replacement}${asMarkdown ? '.md' : ''}`, 301);
    }
    const article = articleBySlug(slug);
    if (article) {
      const path = articlePath(article);
      return asMarkdown || wantsMarkdown(c)
        ? md(c, path, articleMarkdown(config, article))
        : html(c, path, knowledgeArticlePage(config, article));
    }
    if (slug === LEGAL_HUB_PATH.split('/').pop()) {
      return asMarkdown || wantsMarkdown(c)
        ? md(c, LEGAL_HUB_PATH, legalHubMarkdown(config))
        : html(c, LEGAL_HUB_PATH, legalHubPage(config));
    }
    const group = groupBySlug(slug);
    if (group) {
      const path = `/knowledge-base/${groupSlug(group)}`;
      return asMarkdown || wantsMarkdown(c)
        ? md(c, path, groupMarkdown(config, group))
        : html(c, path, knowledgeGroupPage(config, group));
    }
    return c.notFound();
  });

  // The knowledge base first lived at /knowledge; those links keep working.
  app.get('/knowledge', (c) => c.redirect('/knowledge-base', 301));
  app.get('/knowledge.md', (c) => c.redirect('/knowledge-base.md', 301));
  app.get('/knowledge/:file', (c) => c.redirect(`/knowledge-base/${c.req.param('file')}`, 301));

  return app;
}
