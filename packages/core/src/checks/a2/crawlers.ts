/**
 * The robots.txt checks per crawler: training decision (A2.1), the crawlers behind AI
 * answers (A2.2), the fetchers and agents that act for a person (A2.5) and outdated crawler
 * names (A2.13). Every token comes from the crawler registry through ../crawlers.ts.
 */
import { listForProse } from '@agentic-readiness/catalog';

import { isAgentNamed, isAllowed, type RobotsTxt } from '../../parsers/robots.js';
import {
  LEGACY_TOKENS,
  SEARCH_CRAWLERS,
  SHARED_TRAINING_TOKEN,
  TRAINING_CRAWLERS,
  USER_FETCHER_DETAILS,
  type UserFetcher,
} from '../crawlers.js';
import { pathOf } from '../shared.js';
import { defineCheck, fail, pass, skip, warn } from '../types.js';

/** The path the access checks judge: the first sampled product page, else the home page. */
function judgedPath(products: readonly string[]): string {
  return products[0] ? pathOf(products[0]) : '/';
}

/** True when a usage line sets a training value in either vocabulary. */
function statesTraining(robots: RobotsTxt): boolean {
  return robots.usageLines.some(
    (line) =>
      (line.field === 'content-signal' && /\bai-train\s*=/i.test(line.value)) ||
      (line.field === 'content-usage' && /\btrain-ai\s*=/i.test(line.value)),
  );
}

export const trainingPolicyStated = defineCheck('A2.1', ({ target }) => {
  const robots = target.robots;
  if (!robots) {
    return warn('no robots.txt, so no training decision is stated', {
      shared_token: false,
      named: 0,
      total: TRAINING_CRAWLERS.length,
      usage_line: false,
      tokens: {},
    });
  }
  const tokens: Record<string, { named: boolean; allowed: boolean }> = {};
  let named = 0;
  for (const token of TRAINING_CRAWLERS) {
    const isNamed = isAgentNamed(robots, token);
    if (isNamed) named += 1;
    tokens[token] = { named: isNamed, allowed: isAllowed(robots, token, '/') };
  }
  const sharedToken = isAgentNamed(robots, SHARED_TRAINING_TOKEN);
  const usageLine = statesTraining(robots);
  const evidence = {
    shared_token: sharedToken,
    shared_token_allows: sharedToken ? isAllowed(robots, SHARED_TRAINING_TOKEN, '/') : null,
    named,
    total: TRAINING_CRAWLERS.length,
    usage_line: usageLine,
    tokens,
  };
  if (sharedToken) {
    return pass(
      `training decision stated for the shared token ${SHARED_TRAINING_TOKEN}${named > 0 ? ` and ${named} named crawler(s)` : ''}`,
      evidence,
    );
  }
  if (named > 0) {
    return pass(
      `training decision stated for ${named} of ${TRAINING_CRAWLERS.length} documented training tokens`,
      evidence,
    );
  }
  if (usageLine) {
    return pass('training preference stated in a Content-Signal or Content-Usage line', evidence);
  }
  return warn('robots.txt states no decision about AI training crawlers', evidence);
});

export const searchCrawlersAllowed = defineCheck('A2.2', ({ target }) => {
  const robots = target.robots;
  const path = judgedPath(target.sampled.products);
  if (!robots) {
    return pass('no robots.txt rules, so every crawler may read the page', { path, crawlers: {} });
  }
  const crawlers: Record<string, { allowed: boolean; core: boolean; tier: string; feeds: string }> =
    {};
  const blocked = { core: [] as string[], assistant: [] as string[], other: [] as string[] };
  const feeds = new Map<string, string>();
  for (const crawler of SEARCH_CRAWLERS) {
    const allowed = isAllowed(robots, crawler.token, path);
    crawlers[crawler.token] = {
      allowed,
      core: crawler.core,
      tier: crawler.tier,
      feeds: crawler.feeds,
    };
    feeds.set(crawler.token, crawler.feeds);
    if (!allowed) blocked[crawler.tier].push(crawler.token);
  }
  const evidence = {
    path,
    crawlers,
    blocked: [...blocked.core, ...blocked.assistant, ...blocked.other],
    blocked_by_tier: blocked,
  };
  const otherNote =
    blocked.other.length > 0
      ? `. Also disallowed, reported without changing the verdict: ${listForProse(blocked.other)} (regional or developer services)`
      : '';
  if (blocked.core.length > 0) {
    return fail(
      `${listForProse(blocked.core)} disallowed on ${path}, so the AI answers built on that index lose the site${otherNote}`,
      evidence,
    );
  }
  const what = (tokens: string[]): string =>
    tokens.map((token) => `${token} (${feeds.get(token) ?? ''})`).join('; ');
  if (blocked.assistant.length >= 2) {
    return fail(`disallowed on ${path}: ${what(blocked.assistant)}${otherNote}`, evidence);
  }
  if (blocked.assistant.length === 1) {
    return warn(`disallowed on ${path}: ${what(blocked.assistant)}${otherNote}`, evidence);
  }
  const reachable = SEARCH_CRAWLERS.length - blocked.other.length;
  return pass(
    blocked.other.length > 0
      ? `the core and major-assistant crawlers may read ${path}${otherNote}`
      : `all ${reachable} search and assistant crawlers may read ${path}`,
    evidence,
  );
});

/**
 * One clause per robots.txt behaviour, because a Disallow means different things: a block
 * for a fetcher that obeys robots.txt, a recorded intent for one that may fetch anyway.
 */
function fetcherConsequence(blocked: readonly UserFetcher[]): string {
  const obey = blocked.filter((fetcher) => fetcher.robots === 'honours').map((f) => f.token);
  const ignore = blocked.filter((fetcher) => fetcher.robots === 'may-ignore').map((f) => f.token);
  const silent = blocked.filter((fetcher) => fetcher.robots === 'not-stated').map((f) => f.token);
  return [
    obey.length > 0 ? `${listForProse(obey)} obey robots.txt, so this is a real block` : '',
    ignore.length > 0
      ? `${listForProse(ignore)} may fetch anyway when a person asks, so the rule records intent`
      : '',
    silent.length > 0 ? `for ${listForProse(silent)} the operator does not say` : '',
  ]
    .filter(Boolean)
    .join('; ');
}

export const userFetchersAllowed = defineCheck('A2.5', ({ target }) => {
  const robots = target.robots;
  const path = judgedPath(target.sampled.products);
  if (!robots) {
    return pass('no robots.txt rules, so user-triggered fetchers are not disallowed', {
      path,
      fetchers: {},
    });
  }
  const fetchers: Record<string, boolean> = {};
  const blocked: UserFetcher[] = [];
  for (const fetcher of USER_FETCHER_DETAILS) {
    const allowed = isAllowed(robots, fetcher.token, path);
    fetchers[fetcher.token] = allowed;
    if (!allowed) blocked.push(fetcher);
  }
  const major = blocked.filter((fetcher) => fetcher.tier !== 'other');
  const evidence = {
    path,
    fetchers,
    blocked: blocked.map((fetcher) => fetcher.token),
    robots_behaviour: Object.fromEntries(blocked.map((fetcher) => [fetcher.token, fetcher.robots])),
  };
  if (blocked.length === 0) {
    return pass(
      `all ${USER_FETCHER_DETAILS.length} user-triggered fetchers and agents may fetch ${path}`,
      evidence,
    );
  }
  const message = `${listForProse(blocked.map((fetcher) => fetcher.token))} disallowed on ${path} (${fetcherConsequence(blocked)})`;
  return major.length > 0 ? fail(message, evidence) : warn(message, evidence);
});

export const crawlerNamesCurrent = defineCheck('A2.13', ({ target }) => {
  const robots = target.robots;
  if (!robots) {
    return skip('not_applicable', 'no robots.txt, so there are no crawler names to compare', {});
  }
  const found = LEGACY_TOKENS.filter((legacy) => isAgentNamed(robots, legacy.token)).map(
    (legacy) => ({
      token: legacy.token,
      operator: legacy.operator,
      status: legacy.status,
      current: legacy.replaced_by,
      current_named: legacy.replaced_by.filter((token) => isAgentNamed(robots, token)),
    }),
  );
  const evidence = { outdated: found };
  if (found.length === 0) return pass('robots.txt names no outdated crawler tokens', evidence);
  const unreached = found.filter(
    (entry) => entry.current.length > 0 && entry.current_named.length === 0,
  );
  if (unreached.length > 0) {
    // One sentence per operator: "anthropic-ai and claude-web, but not Anthropic's ClaudeBot, …".
    const operators = [...new Set(unreached.map((entry) => entry.operator))];
    const clauses = operators.map((operator) => {
      const entries = unreached.filter((entry) => entry.operator === operator);
      const current = [...new Set(entries.flatMap((entry) => entry.current))];
      return `${listForProse(entries.map((entry) => entry.token))} but none of ${operator}'s current tokens (${listForProse(current)})`;
    });
    return warn(
      `robots.txt names ${clauses.join('; and ')}. Those groups reach none of the crawlers they were written for, which read their own tokens or the * group`,
      evidence,
    );
  }
  const noCrawler = found.filter((entry) => entry.current.length === 0);
  const covered = found.filter((entry) => entry.current.length > 0);
  return pass(
    [
      covered.length > 0
        ? `robots.txt names outdated tokens (${listForProse(covered.map((entry) => entry.token))}) alongside the current ones`
        : '',
      noCrawler.length > 0
        ? `${covered.length > 0 ? 'it also names' : 'robots.txt names'} ${listForProse(noCrawler.map((entry) => entry.token))}, whose operator runs no crawler, so those groups have no effect`
        : '',
    ]
      .filter(Boolean)
      .join('; '),
    evidence,
  );
});
