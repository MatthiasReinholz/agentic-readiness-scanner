/**
 * Routes for the knowledge base, the sitemap and llms-full.txt. Every page answers as
 * HTML, or as Markdown when the path ends in .md or the client sends Accept: text/markdown
 * first; the bare URL varies on Accept so caches keep the two apart.
 */
import { catalog } from '@agentic-readiness/catalog';
import { knowledge } from '@agentic-readiness/catalog/knowledge';
import { Hono, type Context } from 'hono';

import type { AppConfig } from '../config.js';
import {
  articleByCheckId,
  articleBySlug,
  articleMarkdown,
  articlePath,
  groupBySlug,
  groupSlug,
  knowledgeArticlePage,
  knowledgeFullMarkdown,
  knowledgeGroupPage,
  knowledgeIndexMarkdown,
  knowledgeIndexPage,
  KNOWLEDGE_UPDATED,
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
    `- [Knowledge base index](${config.baseUrl}/knowledge.md): every section and check in one list`,
    ...knowledge.map((article) => {
      return `- [${article.id} ${article.headline}](${config.baseUrl}${articlePath(article)}.md): ${article.description}`;
    }),
  ].join('\n');
}

function sitemapXml(config: AppConfig): string {
  const urls = [
    '/',
    '/knowledge',
    ...catalog.groups.map((group) => `/knowledge/${groupSlug(group)}`),
    ...knowledge.map(articlePath),
  ];
  return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls.map((path) => `<url><loc>${config.baseUrl}${path}</loc>${path.startsWith('/knowledge') ? `<lastmod>${KNOWLEDGE_UPDATED}</lastmod>` : ''}</url>`).join('\n')}
</urlset>
`;
}

export function createKnowledgeRoutes(config: AppConfig): Hono {
  const app = new Hono();

  app.get('/sitemap.xml', (c) =>
    c.body(sitemapXml(config), 200, {
      'content-type': 'application/xml; charset=utf-8',
      'cache-control': CACHE,
    }),
  );

  app.get('/llms-full.txt', (c) => markdown(c, knowledgeFullMarkdown(config)));

  app.get('/knowledge.md', (c) => markdown(c, knowledgeIndexMarkdown(config)));
  app.get('/knowledge/', (c) => c.redirect('/knowledge', 301));
  app.get('/knowledge', (c) => {
    if (wantsMarkdown(c)) return markdown(c, knowledgeIndexMarkdown(config));
    c.header('cache-control', CACHE);
    c.header('vary', 'Accept');
    return c.html(knowledgeIndexPage(config));
  });

  app.get('/knowledge/:file', (c) => {
    const file = c.req.param('file');
    const asMarkdown = file.endsWith('.md');
    const slug = asMarkdown ? file.slice(0, -3) : file;
    // A check id (/knowledge/A2.2) moves to its article, so reports and agents can link by id.
    if (/^[ab]\d\.\d+$/i.test(slug)) {
      const byId = articleByCheckId(slug);
      if (byId) return c.redirect(`${articlePath(byId)}${asMarkdown ? '.md' : ''}`, 301);
    }
    const article = articleBySlug(slug);
    if (article) {
      if (asMarkdown || wantsMarkdown(c)) return markdown(c, articleMarkdown(config, article));
      c.header('cache-control', CACHE);
      c.header('vary', 'Accept');
      return c.html(knowledgeArticlePage(config, article));
    }
    const group = groupBySlug(slug);
    if (group && !asMarkdown) {
      c.header('cache-control', CACHE);
      return c.html(knowledgeGroupPage(config, group));
    }
    return c.notFound();
  });

  return app;
}
