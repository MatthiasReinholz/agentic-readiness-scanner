import { isAgentNamed, isAllowed } from '../../parsers/robots.js';
import { pathOf, productPages } from '../shared.js';
import { defineCheck, fail, pass, skip, warn } from '../types.js';

export const AI_TRAINING_CRAWLERS = [
  'GPTBot',
  'ClaudeBot',
  'Google-Extended',
  'PerplexityBot',
  'CCBot',
  'Bytespider',
  'Applebot-Extended',
] as const;

export const SHOPPING_AGENTS = [
  'ChatGPT-User',
  'Claude-User',
  'OAI-SearchBot',
  'Google-Agent',
  'Perplexity-User',
] as const;

export const aiCrawlerRulesExplicit = defineCheck('A2.1', ({ target }) => {
  const robots = target.robots;
  if (!robots) {
    return fail('no robots.txt to state crawler decisions in', { bots: {} });
  }
  const bots: Record<string, { named: boolean; allowed: boolean }> = {};
  let named = 0;
  for (const bot of AI_TRAINING_CRAWLERS) {
    const isNamed = isAgentNamed(robots, bot);
    if (isNamed) named += 1;
    bots[bot] = { named: isNamed, allowed: isAllowed(robots, bot, '/') };
  }
  const evidence = { bots, named, total: AI_TRAINING_CRAWLERS.length };
  if (named === AI_TRAINING_CRAWLERS.length) {
    return pass('every major AI training crawler has an explicit rule', evidence);
  }
  if (named > 0) {
    return warn(
      `${named} of ${AI_TRAINING_CRAWLERS.length} AI training crawlers have an explicit rule`,
      evidence,
    );
  }
  return fail('robots.txt names no AI training crawler', evidence);
});

export const shoppingAgentsAllowed = defineCheck('A2.2', ({ target }) => {
  const robots = target.robots;
  const productPath = target.sampled.products[0] ? pathOf(target.sampled.products[0]) : '/';
  if (!robots) {
    return pass('no robots.txt rules; shopping agents are allowed by default', {
      path: productPath,
      agents: {},
    });
  }
  const agents: Record<string, boolean> = {};
  const blocked: string[] = [];
  for (const agent of SHOPPING_AGENTS) {
    const allowed = isAllowed(robots, agent, productPath);
    agents[agent] = allowed;
    if (!allowed) blocked.push(agent);
  }
  const evidence = { path: productPath, agents };
  if (blocked.length > 0) {
    return fail(`${blocked.join(', ')} blocked on ${productPath}`, evidence);
  }
  return pass(`all shopping agents may fetch ${productPath}`, evidence);
});

const BLOCKING = /\bnoindex\b/i;
const LIMITING = /\bnosnippet\b|\bnoai\b|\bnoimageai\b|max-snippet:\s*0\b/i;

export const noIndexingRestrictionsOnProducts = defineCheck('A2.6', async ({ target, fetcher }) => {
  const pages = await productPages(target, fetcher);
  if (pages.length === 0) {
    return skip('not_applicable', 'no product pages sampled');
  }
  const perPage: Record<string, { header: string | null; meta: string | null }> = {};
  let blocking = 0;
  let limiting = 0;
  for (const page of pages) {
    const response = await fetcher.fetch(page.url);
    const header = response.headers['x-robots-tag'] ?? null;
    const meta = page.doc.meta('robots');
    perPage[page.url] = { header, meta };
    const directives = `${header ?? ''} ${meta ?? ''}`;
    if (BLOCKING.test(directives)) blocking += 1;
    else if (LIMITING.test(directives)) limiting += 1;
  }
  const evidence = { pages: perPage };
  if (blocking > 0) return fail(`${blocking} sampled product page(s) carry noindex`, evidence);
  if (limiting > 0)
    return warn(`${limiting} sampled product page(s) limit snippets or AI use`, evidence);
  return pass('no indexing restrictions on sampled product pages', evidence);
});
