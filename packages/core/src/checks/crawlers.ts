/**
 * The crawler and fetcher product tokens the access checks evaluate, grouped by what the
 * operator documents them for. The grouping is the point: blocking a training crawler is
 * a licensing decision and never loses points; blocking the crawler that builds an
 * assistant's index removes the site from that assistant's answers; user-triggered
 * fetchers mostly ignore robots.txt because a person asked for the page.
 *
 * Every token below is documented by its operator (see the spec URLs of A2.1, A2.2 and
 * A2.5 in the catalog). Tokens that appear only in third-party block lists are left out.
 */

/** The shared robots.txt token for AI training preferences (draft-kelley-aipref-training-preference-signal). */
export const SHARED_TRAINING_TOKEN = '__usage_ai-training';

export const TRAINING_CRAWLERS = [
  'GPTBot',
  'ClaudeBot',
  'Google-Extended',
  'Applebot-Extended',
  'meta-externalagent',
  'Amazonbot',
  'CCBot',
  'Bytespider',
  'MistralAI-Training',
] as const;

export interface SearchCrawler {
  token: string;
  /** Which assistants or surfaces lose the site when this crawler is blocked. */
  feeds: string;
  /** Blocking a core crawler fails the check on its own. */
  core: boolean;
}

/** Crawlers that build the indexes behind AI answers. */
export const SEARCH_CRAWLERS: readonly SearchCrawler[] = [
  {
    token: 'Googlebot',
    feeds:
      'Google Search, AI Overviews, AI Mode and Gemini; Brave Search (Claude) follows its rules',
    core: true,
  },
  {
    token: 'Bingbot',
    feeds: 'Bing, Microsoft Copilot and ChatGPT search (Bing is a named search partner)',
    core: true,
  },
  { token: 'Applebot', feeds: 'Siri, Spotlight and Apple Intelligence', core: false },
  { token: 'Storebot-Google', feeds: 'Google Shopping surfaces', core: false },
  { token: 'OAI-SearchBot', feeds: 'ChatGPT search answers', core: false },
  { token: 'Claude-SearchBot', feeds: 'Claude web search', core: false },
  { token: 'PerplexityBot', feeds: 'Perplexity answers', core: false },
  { token: 'Amzn-SearchBot', feeds: 'Alexa and Amazon search', core: false },
  { token: 'DuckAssistBot', feeds: 'DuckDuckGo AI-assisted answers', core: false },
  { token: 'MistralAI-Index', feeds: 'Mistral search', core: false },
  { token: 'meta-webindexer', feeds: 'Meta AI search citations', core: false },
];

/** Fetchers assistants use when a person asks about a page; most ignore robots.txt. */
export const USER_FETCHERS = [
  'ChatGPT-User',
  'Claude-User',
  'Perplexity-User',
  'Google-Agent',
  'meta-externalfetcher',
  'Amzn-User',
  'MistralAI-User',
] as const;
