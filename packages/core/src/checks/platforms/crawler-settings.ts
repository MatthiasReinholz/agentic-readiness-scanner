/**
 * Bot settings of hosted site builders. Each writes a documented group of user agents
 * into robots.txt with one switch; the checks recognise the group and name the switch.
 */
import { SEARCH_CRAWLERS, USER_FETCHERS } from '../crawlers.js';
import { defineCheck, fail, pass, skip, warn } from '../types.js';
import { disallowed } from './shared.js';

/** Squarespace: Settings > Crawlers > "Block known artificial intelligence crawlers". */
export const SQUARESPACE_AI_CRAWLERS = [
  'AI2Bot',
  'Ai2Bot-Dolma',
  'aiHitBot',
  'Amazonbot',
  'anthropic-ai',
  'Applebot-Extended',
  'Bytespider',
  'CCBot',
  'ClaudeBot',
  'cohere-ai',
  'cohere-training-data-crawler',
  'DuckAssistBot',
  'FacebookBot',
  'Google-Extended',
  'GoogleOther',
  'GoogleOther-Image',
  'GoogleOther-Video',
  'GPTBot',
  'img2dataset',
  'Meta-ExternalAgent',
  'MyCentralAIScraperBot',
  'omgili',
  'omgilibot',
  'Quora-Bot',
  'TikTokSpider',
  'YouBot',
] as const;

/** Webflow: Site settings > SEO > Indexing > Traffic control, "Search engine crawlers". */
export const WEBFLOW_SEARCH_BOTS = [
  'YandexBot',
  'Googlebot',
  'Bingbot',
  'Baiduspider',
  'OAI-SearchBot',
  'Sogou',
  'DuckDuckBot',
  'MojeekBot',
  'SeznamBot',
  'Qwantify',
  'Yeti',
  'Slurp',
  '360Spider',
] as const;

/** Webflow: the same panel's "AI bots" group. */
export const WEBFLOW_AI_BOTS = [
  'meta-externalagent',
  'ChatGPT-User',
  'ClaudeBot',
  'PerplexityBot',
  'GPTBot',
  'GoogleOther',
  'Timpibot',
  'SBIntuitionsBot',
  'Bytespider',
  'AI2Bot',
  'Amazon Q',
  'Claude-User',
  'CCBot',
  'Diffbot',
  'YandexGPT',
  'MistralBot',
  'cohere-ai',
  'youBot',
  'NeevaAI',
] as const;

/** A switch is taken as on when robots.txt disallows most of its group at the root. */
function switchedOn(blocked: readonly string[], group: readonly string[]): boolean {
  return blocked.length >= Math.ceil(group.length * 0.6);
}

/** Agents whose loss removes the site from AI answers: index crawlers and user-triggered fetchers. */
const ANSWER_AGENTS = new Set(
  [...SEARCH_CRAWLERS.map((crawler) => crawler.token), ...USER_FETCHERS, 'YouBot'].map((token) =>
    token.toLowerCase(),
  ),
);

export const squarespaceAiCrawlerSetting = defineCheck('A2.9', ({ target }) => {
  if (!target.robots) {
    return skip(
      'not_applicable',
      'robots.txt could not be read, so the setting is not visible',
      {},
    );
  }
  const blocked = disallowed(target.robots, SQUARESPACE_AI_CRAWLERS);
  const answers = blocked.filter((token) => ANSWER_AGENTS.has(token.toLowerCase()));
  const evidence = {
    blocked,
    answer_agents_blocked: answers,
    listed: SQUARESPACE_AI_CRAWLERS.length,
  };
  if (!switchedOn(blocked, SQUARESPACE_AI_CRAWLERS)) {
    return pass(
      "Block known artificial intelligence crawlers is off: the agents on Squarespace's list may read the site",
      evidence,
    );
  }
  if (answers.length === 0) {
    return pass(
      `Block known artificial intelligence crawlers is on; it keeps ${blocked.length} training crawlers out and no crawler behind AI answers`,
      evidence,
    );
  }
  return warn(
    `Block known artificial intelligence crawlers is on (${blocked.length} of ${SQUARESPACE_AI_CRAWLERS.length} agents disallowed); besides training crawlers it shuts out ${answers.join(', ')}, which feed AI answers`,
    evidence,
  );
});

export const webflowTrafficControl = defineCheck('A2.10', ({ target }) => {
  if (!target.robots) {
    return skip(
      'not_applicable',
      'robots.txt could not be read, so the setting is not visible',
      {},
    );
  }
  const search = disallowed(target.robots, WEBFLOW_SEARCH_BOTS);
  const ai = disallowed(target.robots, WEBFLOW_AI_BOTS);
  const searchOff = switchedOn(search, WEBFLOW_SEARCH_BOTS);
  const aiOff = switchedOn(ai, WEBFLOW_AI_BOTS);
  const evidence = {
    search_bots_blocked: search,
    ai_bots_blocked: ai,
    search_off: searchOff,
    ai_off: aiOff,
  };
  if (searchOff && aiOff) {
    return fail(
      'both Traffic control switches are off: search engine crawlers and AI bots are disallowed, so the site drops out of search and AI answers',
      evidence,
    );
  }
  if (searchOff) {
    return fail(
      `Traffic control has search engine crawlers off (${search.join(', ')} disallowed); search and the AI answers built on it lose the site`,
      evidence,
    );
  }
  if (aiOff) {
    const answers = ai.filter((token) => ANSWER_AGENTS.has(token.toLowerCase()));
    return fail(
      `Traffic control has AI bots off; besides training crawlers that disallows ${answers.join(', ') || "the assistants' agents"}, which fetch pages for ChatGPT, Claude and Perplexity answers`,
      evidence,
    );
  }
  return pass('both Traffic control groups are allowed, as Webflow sets by default', evidence);
});
