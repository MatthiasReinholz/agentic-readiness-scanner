import type { FetchedResponse } from '../../http/types.js';
import { extractJsonLd } from '../../parsers/jsonld.js';
import { elementText } from '../../parsers/html.js';
import { mediaTypeOf, parseLinkHeader } from '../../parsers/link-header.js';
import { isAgentNamed, isAllowed, type RobotsTxt } from '../../parsers/robots.js';
import {
  parseTdmrepJson,
  validateAbsoluteUrl,
  validateContentSignal,
  validateContentUsage,
  validateLicenseUrl,
  validateTdmReservation,
  type SignalValidation,
} from '../../parsers/usage-preferences.js';
import {
  SEARCH_CRAWLERS,
  SHARED_TRAINING_TOKEN,
  TRAINING_CRAWLERS,
  USER_FETCHERS,
} from '../crawlers.js';
import { pathOf, productPages } from '../shared.js';
import { defineCheck, fail, pass, skip, warn, type CheckOutcome } from '../types.js';

export { SEARCH_CRAWLERS, SHARED_TRAINING_TOKEN, TRAINING_CRAWLERS, USER_FETCHERS };

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
      `training decision stated for ${named} of ${TRAINING_CRAWLERS.length} documented training crawlers`,
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
  const path = target.sampled.products[0] ? pathOf(target.sampled.products[0]) : '/';
  if (!robots) {
    return pass('no robots.txt rules; every crawler may read the page', { path, crawlers: {} });
  }
  const crawlers: Record<string, { allowed: boolean; core: boolean; feeds: string }> = {};
  const blockedCore: string[] = [];
  const blockedOther: string[] = [];
  for (const crawler of SEARCH_CRAWLERS) {
    const allowed = isAllowed(robots, crawler.token, path);
    crawlers[crawler.token] = { allowed, core: crawler.core, feeds: crawler.feeds };
    if (!allowed) (crawler.core ? blockedCore : blockedOther).push(crawler.token);
  }
  const evidence = { path, crawlers, blocked: [...blockedCore, ...blockedOther] };
  if (blockedCore.length > 0) {
    return fail(
      `${blockedCore.join(' and ')} disallowed on ${path}; the AI answers built on that index lose the site`,
      evidence,
    );
  }
  if (blockedOther.length >= 2) {
    return fail(`${blockedOther.join(', ')} disallowed on ${path}`, evidence);
  }
  if (blockedOther.length === 1) {
    return warn(`${blockedOther[0] ?? ''} disallowed on ${path}`, evidence);
  }
  return pass(
    `all ${SEARCH_CRAWLERS.length} search and assistant crawlers may read ${path}`,
    evidence,
  );
});

export const userFetchersAllowed = defineCheck('A2.5', ({ target }) => {
  const robots = target.robots;
  const path = target.sampled.products[0] ? pathOf(target.sampled.products[0]) : '/';
  if (!robots) {
    return pass('no robots.txt rules; user-triggered fetchers are not disallowed', {
      path,
      fetchers: {},
    });
  }
  const fetchers: Record<string, boolean> = {};
  const blocked: string[] = [];
  for (const token of USER_FETCHERS) {
    const allowed = isAllowed(robots, token, path);
    fetchers[token] = allowed;
    if (!allowed) blocked.push(token);
  }
  const evidence = { path, fetchers, blocked };
  if (blocked.length > 0) {
    return fail(
      `${blocked.join(', ')} disallowed on ${path} (most fetch anyway when a person asks; the rule records intent)`,
      evidence,
    );
  }
  return pass(`all ${USER_FETCHERS.length} user-triggered fetchers may fetch ${path}`, evidence);
});

const NOINDEX = /\bnoindex\b/i;
/**
 * Google documents that these keep the page out of AI Overviews and AI Mode, and Apple
 * generates no web answer from such a page. Named individually so the message can say
 * which one was found.
 */
const GOOGLE_LIMITS: readonly { name: string; pattern: RegExp }[] = [
  { name: 'nosnippet', pattern: /\bnosnippet\b/i },
  { name: 'max-snippet:0', pattern: /max-snippet:\s*0\b/i },
];
/**
 * Bing: noarchive and nocache keep the page out of Copilot answers or reduce it to URL,
 * title and snippet; ai-grounding:disallow and disallowextended opt out of grounding.
 * The directive may arrive in the Bingbot meta tag or in an X-Robots-Tag header whose
 * value is prefixed with the crawler name (`X-Robots-Tag: bingbot: ai-grounding:disallow`);
 * the patterns match inside either form.
 */
const BING_LIMITS: readonly { name: string; pattern: RegExp }[] = [
  { name: 'noarchive', pattern: /\bnoarchive\b/i },
  { name: 'nocache', pattern: /\bnocache\b/i },
  { name: 'ai-grounding:disallowextended', pattern: /ai-grounding:\s*disallowextended\b/i },
  { name: 'ai-grounding:disallow', pattern: /ai-grounding:\s*disallow\b/i },
];
const BINGBOT_HEADER_PREFIX = /(^|,)\s*bingbot\s*:/i;
/** A declared preference without a documented consumer among major crawlers. */
const DECLARED_ONLY = /\bnoai\b|\bnoimageai\b/i;
/** A data-nosnippet element covering this share of the page text counts as wrapping it. */
const NOSNIPPET_COVERAGE = 0.5;

interface PageDirectives {
  header: string | null;
  /** True when the X-Robots-Tag header scopes a value to Bingbot with a `bingbot:` prefix. */
  header_for_bingbot: boolean;
  meta: string | null;
  bingbot: string | null;
  nosnippet_coverage: number;
  not_accessible_for_free: boolean;
  declared_preferences: string[];
}

export const noAnswerExclusionDirectives = defineCheck('A2.6', async ({ target, fetcher }) => {
  const pages = await productPages(target, fetcher);
  if (pages.length === 0) {
    return skip('not_applicable', 'no product pages sampled');
  }
  const perPage: Record<string, PageDirectives> = {};
  const blocking: string[] = [];
  const blockingDirectives = new Set<string>();
  const limiting: string[] = [];
  for (const page of pages) {
    const response = await fetcher.fetch(page.url);
    const header = response.headers['x-robots-tag'] ?? null;
    const meta = page.doc.meta('robots');
    const bingbot = page.doc.meta('bingbot');
    const directives = `${header ?? ''} ${meta ?? ''} ${bingbot ?? ''}`;
    const pageWords = page.doc.wordCount();
    let covered = 0;
    for (const element of page.doc.find('*', 'data-nosnippet', /^/)) {
      covered = Math.max(covered, elementText(element).split(' ').filter(Boolean).length);
    }
    const coverage = pageWords > 0 ? covered / pageWords : 0;
    const notFree = extractJsonLd(page.doc).nodes.some(
      (node) =>
        node.isAccessibleForFree === false ||
        String(node.isAccessibleForFree).toLowerCase() === 'false',
    );
    const declared = DECLARED_ONLY.exec(directives)
      ? [DECLARED_ONLY.exec(directives)?.[0] ?? '']
      : [];
    perPage[page.url] = {
      header,
      header_for_bingbot: header !== null && BINGBOT_HEADER_PREFIX.test(header),
      meta,
      bingbot,
      nosnippet_coverage: Number(coverage.toFixed(2)),
      not_accessible_for_free: notFree,
      declared_preferences: declared,
    };
    const blocks: string[] = [];
    if (NOINDEX.test(directives)) blocks.push('noindex');
    for (const limit of GOOGLE_LIMITS) {
      if (limit.pattern.test(directives)) blocks.push(limit.name);
    }
    if (coverage >= NOSNIPPET_COVERAGE) blocks.push('data-nosnippet around the main content');
    if (blocks.length > 0) {
      blocking.push(`${page.url}: ${blocks.join(', ')}`);
      for (const block of blocks) blockingDirectives.add(block);
      continue;
    }
    const reasons: string[] = [];
    const bing = BING_LIMITS.find((limit) => limit.pattern.test(directives));
    if (bing) reasons.push(`Bing ${bing.name}`);
    if (notFree) reasons.push('isAccessibleForFree:false (Apple Intelligence)');
    if (reasons.length > 0) limiting.push(`${page.url}: ${reasons.join(', ')}`);
  }
  const evidence = { pages: perPage, blocking, limiting };
  if (blocking.length > 0) {
    const named = [...blockingDirectives].join(', ');
    const consequence = blockingDirectives.has('noindex')
      ? 'the page leaves the search index that Google AI Overviews and AI Mode and Apple web answers are built on'
      : 'Google documents that this keeps the page out of AI Overviews and AI Mode, and Apple generates no web answer from it';
    return fail(
      `${blocking.length} sampled product page(s) carry ${named}; ${consequence}`,
      evidence,
    );
  }
  if (limiting.length > 0) {
    return warn(
      `${limiting.length} sampled product page(s) carry directives that keep them out of AI answers`,
      evidence,
    );
  }
  return pass('no directives withdraw the sampled product pages from AI answers', evidence);
});

/** Kept for the policy-readability check, which asks whether the crawlers behind answers may read a page. */
export function blockedSearchCrawlers(robots: RobotsTxt, path: string): string[] {
  return SEARCH_CRAWLERS.filter((crawler) => !isAllowed(robots, crawler.token, path)).map(
    (crawler) => crawler.token,
  );
}

export type { CheckOutcome };

/** Status codes that refuse a polite client outright. */
const REFUSAL_STATUSES = new Set([402, 403, 429, 451]);
/** Page titles and phrases that bot-management products put on challenge and denial pages. */
const CHALLENGE_PAGE =
  /just a moment|attention required|access denied|verify you are human|checking your browser|enable javascript and cookies to continue|请稍候|pardon our interruption|request unsuccessful|incapsula incident|perimeterx|datadome|are you a robot/i;
/** Redirect targets that stand in for the content: consent, region and geo interstitials. */
const INTERSTITIAL_PATH =
  /consent|gdpr|cookie|privacy-choices|choose-(country|region|location)|geo|region-select|unsupported|not-available/i;

interface FetchVerdict {
  status: number;
  final_url: string;
  outcome: 'ok' | 'refused' | 'challenged' | 'interstitial' | 'not_fetched';
  detail: string | null;
}

function classifyResponse(response: FetchedResponse): FetchVerdict {
  const base = { status: response.status, final_url: response.finalUrl };
  if (response.status === 0) {
    return { ...base, outcome: 'not_fetched', detail: response.error ?? 'no response' };
  }
  if ((response.headers['cf-mitigated'] ?? '').toLowerCase() === 'challenge') {
    return { ...base, outcome: 'challenged', detail: 'cf-mitigated: challenge' };
  }
  if (REFUSAL_STATUSES.has(response.status)) {
    return { ...base, outcome: 'refused', detail: `HTTP ${response.status}` };
  }
  const head = response.body.slice(0, 4000);
  const title = /<title[^>]*>([^<]{0,200})/i.exec(head)?.[1]?.trim() ?? '';
  if (
    CHALLENGE_PAGE.test(title) ||
    (response.status === 200 && CHALLENGE_PAGE.test(head) && response.bytes < 20_000)
  ) {
    return { ...base, outcome: 'challenged', detail: `challenge page (${title || 'no title'})` };
  }
  if (response.redirects > 0) {
    try {
      const final = new URL(response.finalUrl);
      const requested = new URL(response.url);
      if (
        final.pathname !== requested.pathname &&
        INTERSTITIAL_PATH.test(final.pathname + final.search)
      ) {
        return { ...base, outcome: 'interstitial', detail: `redirected to ${final.pathname}` };
      }
    } catch {
      // unparsable final URL: treat as an ordinary response
    }
  }
  return { ...base, outcome: 'ok', detail: null };
}

export const honestFetchNotBlocked = defineCheck('A2.4', async ({ target, fetcher }) => {
  // The pages an agent must reach to use the store at all: home, robots.txt and the
  // product pages. A refusal there is a block. The policy pages matter too, but one of them
  // behind a login wall or a stricter rule does not make the store unreachable.
  const gate: FetchedResponse[] = [target.home, target.robotsResponse];
  for (const url of target.sampled.products) gate.push(await fetcher.fetch(url));
  const policy: FetchedResponse[] = [];
  for (const url of Object.values(target.sampled.policies)) {
    if (url.startsWith(target.origin)) policy.push(await fetcher.fetch(url));
  }
  const pages: Record<string, FetchVerdict> = {};
  const refused: string[] = [];
  const challenged: string[] = [];
  const interstitial: string[] = [];
  const policyUrls = new Set<string>();
  for (const [responses, isPolicy] of [
    [gate, false],
    [policy, true],
  ] as const) {
    for (const response of responses) {
      const verdict = classifyResponse(response);
      pages[response.url] = verdict;
      if (isPolicy) policyUrls.add(response.url);
      if (verdict.outcome === 'refused') refused.push(response.url);
      if (verdict.outcome === 'challenged') challenged.push(response.url);
      if (verdict.outcome === 'interstitial') interstitial.push(response.url);
    }
  }
  const blocked = [...challenged, ...refused];
  const blockedGate = blocked.filter((url) => !policyUrls.has(url));
  const blockedPolicy = blocked.filter((url) => policyUrls.has(url));
  const evidence = {
    user_agent:
      'the scanner identifies itself as AgenticReadinessScanner with a documentation URL and never impersonates another agent',
    pages,
    refused,
    challenged,
    interstitial,
    blocked_policy_pages: blockedPolicy,
  };
  const note =
    ' (verified crawlers fetching from published IP ranges or with signed requests may be treated differently)';
  const statusesOf = (urls: string[]): string =>
    [...new Set(urls.map((url) => pages[url]?.status))].join(', ');
  if (blockedGate.length > 0) {
    const gateChallenged = blockedGate.filter((url) => challenged.includes(url));
    if (gateChallenged.length > 0) {
      return fail(
        `${gateChallenged.length} page(s) answered with a bot-management challenge${note}`,
        evidence,
      );
    }
    return fail(
      `${blockedGate.length} page(s) refused an honestly identified client (HTTP ${statusesOf(blockedGate)})${note}`,
      evidence,
    );
  }
  if (blockedPolicy.length > 0) {
    return warn(
      `the home page and product pages answered, but ${blockedPolicy.length} policy page(s) refused or challenged an honestly identified client (HTTP ${statusesOf(blockedPolicy)}); an agent cannot read them before buying${note}`,
      evidence,
    );
  }
  if (interstitial.length > 0) {
    return warn(
      `${interstitial.length} page(s) redirected to a consent or region interstitial instead of their content`,
      evidence,
    );
  }
  return pass(
    `${gate.length + policy.length} pages fetched without a block, challenge or interstitial`,
    evidence,
  );
});

interface UsageSignal {
  field: string;
  value: string;
  valid: boolean;
  problem?: string;
}

function usageSignal(field: string, value: string, validation: SignalValidation): UsageSignal {
  return {
    field,
    value: value.slice(0, 200),
    valid: validation.valid,
    ...(validation.problem !== undefined ? { problem: validation.problem } : {}),
  };
}

const RSL_TYPE = 'application/rsl+xml';

function resolvedHref(href: string, base: string): string {
  try {
    return new URL(href, base).href;
  } catch {
    return href;
  }
}

export const usagePreferenceSignalsParse = defineCheck('A2.3', async ({ target, fetcher }) => {
  const signals: UsageSignal[] = [];
  for (const line of target.robots?.usageLines ?? []) {
    if (line.field === 'content-signal') {
      signals.push(
        usageSignal('robots.txt Content-Signal', line.value, validateContentSignal(line.value)),
      );
    } else if (line.field === 'content-usage') {
      signals.push(
        usageSignal(
          'robots.txt Content-Usage',
          line.value,
          validateContentUsage(line.value, { allowPath: true }),
        ),
      );
    } else {
      signals.push(usageSignal('robots.txt License', line.value, validateLicenseUrl(line.value)));
    }
  }
  const home = target.home;
  const declared: [string, string | undefined, (value: string) => SignalValidation][] = [
    ['Content-Usage header', home.headers['content-usage'], (value) => validateContentUsage(value)],
    ['tdm-reservation header', home.headers['tdm-reservation'], validateTdmReservation],
    ['tdm-policy header', home.headers['tdm-policy'], (value) => validateAbsoluteUrl(value)],
    [
      'tdm-reservation meta tag',
      target.homeDoc.meta('tdm-reservation') ?? undefined,
      validateTdmReservation,
    ],
    [
      'tdm-policy meta tag',
      target.homeDoc.meta('tdm-policy') ?? undefined,
      (value) => validateAbsoluteUrl(value),
    ],
  ];
  for (const [field, value, validate] of declared) {
    if (value !== undefined) signals.push(usageSignal(field, value, validate(value)));
  }
  for (const link of parseLinkHeader(home.headers.link)) {
    if (link.rel.includes('license') && link.type === RSL_TYPE) {
      const href = resolvedHref(link.href, home.finalUrl);
      signals.push(usageSignal('Link header rel=license (RSL)', href, validateAbsoluteUrl(href)));
    }
  }
  for (const link of target.homeDoc.links()) {
    if (link.rel.split(/\s+/).includes('license') && mediaTypeOf(link.type) === RSL_TYPE) {
      const href = resolvedHref(link.href, home.finalUrl);
      signals.push(usageSignal('<link rel="license"> (RSL)', href, validateAbsoluteUrl(href)));
    }
  }
  const tdmrepUrl = `${target.origin}/.well-known/tdmrep.json`;
  const tdmrep = await fetcher.fetch(tdmrepUrl);
  let tdmrepOutcome: 'absent' | 'soft_404' | 'declared' | 'not_fetched' = 'absent';
  if (tdmrep.status === 0) {
    tdmrepOutcome = 'not_fetched';
  } else if (tdmrep.status === 200) {
    const parsed = parseTdmrepJson(tdmrep.body);
    // An HTML 200 is a soft 404: the file does not exist, nothing is declared.
    if (parsed.kind === 'html') {
      tdmrepOutcome = 'soft_404';
    } else {
      tdmrepOutcome = 'declared';
      signals.push(
        usageSignal('/.well-known/tdmrep.json', tdmrep.body.trim(), {
          valid: parsed.kind === 'valid',
          ...(parsed.problem !== undefined ? { problem: parsed.problem } : {}),
        }),
      );
    }
  }
  const malformed = signals.filter((signal) => !signal.valid);
  const evidence = {
    signals,
    declared: signals.length,
    malformed: malformed.length,
    tdmrep: { url: tdmrepUrl, status: tdmrep.status, outcome: tdmrepOutcome },
  };
  if (signals.length === 0) {
    return pass(
      'no usage-preference signal declared (Content-Signal, Content-Usage, RSL or TDMRep); nothing to parse',
      evidence,
    );
  }
  if (malformed.length > 0) {
    const fields = [...new Set(malformed.map((signal) => signal.field))].join(', ');
    return warn(
      `${malformed.length} of ${signals.length} usage-preference signal(s) malformed: ${fields}`,
      evidence,
    );
  }
  return pass(`${signals.length} usage-preference signal(s) declared and well-formed`, evidence);
});

/** Same-origin scripts and stylesheets evaluated at most, across the sampled pages. */
const RENDER_ASSET_LIMIT = 50;
/** Blocked asset paths kept in evidence per crawler. */
const BLOCKED_ASSET_SAMPLE = 10;

/**
 * Assets under the transactional areas a platform disallows on purpose (Shopify ships a
 * checkout preload script on every product page under /checkouts/). A product page
 * renders without them, so they are recorded, not judged.
 */
const TRANSACTIONAL_ASSET = /\/(checkouts?|cart|accounts?|admin|orders)(\/|$)/i;

export const renderResourcesNotBlocked = defineCheck('A2.7', async ({ target, fetcher }) => {
  const sampled = await productPages(target, fetcher);
  const sources =
    sampled.length > 0
      ? sampled.map((page) => ({ url: page.url, doc: page.doc }))
      : [{ url: target.home.finalUrl, doc: target.homeDoc }];
  const assets = new Set<string>();
  const ignored = new Set<string>();
  for (const source of sources) {
    for (const href of [...source.doc.externalScripts(), ...source.doc.stylesheets()]) {
      if (assets.size >= RENDER_ASSET_LIMIT) break;
      try {
        const url = new URL(href, source.url);
        // Cross-origin assets are outside this robots.txt and are not judged.
        if (url.origin !== target.origin) continue;
        if (TRANSACTIONAL_ASSET.test(url.pathname)) {
          ignored.add(url.pathname + url.search);
          continue;
        }
        assets.add(url.pathname + url.search);
      } catch {
        // an unparsable src or href cannot be fetched by anyone; nothing to evaluate
      }
    }
  }
  const evidence: Record<string, unknown> = {
    pages: sources.map((source) => source.url),
    assets_checked: assets.size,
    ignored_transactional: [...ignored].slice(0, BLOCKED_ASSET_SAMPLE),
    blocked_googlebot: [],
    blocked_bingbot: [],
  };
  if (assets.size === 0) {
    return skip(
      'not_applicable',
      'the sampled pages load no same-origin scripts or stylesheets',
      evidence,
    );
  }
  const robots = target.robots;
  if (!robots) {
    return pass(
      `robots.txt is absent or unparsable, so none of the ${assets.size} same-origin scripts and stylesheets is blocked`,
      evidence,
    );
  }
  const blockedGooglebot: string[] = [];
  const blockedBingbot: string[] = [];
  for (const path of assets) {
    if (!isAllowed(robots, 'Googlebot', path)) blockedGooglebot.push(path);
    if (!isAllowed(robots, 'Bingbot', path)) blockedBingbot.push(path);
  }
  evidence.blocked_googlebot = blockedGooglebot.slice(0, BLOCKED_ASSET_SAMPLE);
  evidence.blocked_bingbot = blockedBingbot.slice(0, BLOCKED_ASSET_SAMPLE);
  evidence.blocked_googlebot_count = blockedGooglebot.length;
  evidence.blocked_bingbot_count = blockedBingbot.length;
  if (blockedGooglebot.length > 0) {
    return fail(
      `${blockedGooglebot.length} of ${assets.size} same-origin scripts and stylesheets are disallowed for Googlebot in robots.txt; Google, Applebot and Bing cannot render the page with them`,
      evidence,
    );
  }
  if (blockedBingbot.length > 0) {
    return warn(
      `${blockedBingbot.length} of ${assets.size} same-origin scripts and stylesheets are disallowed for Bingbot in robots.txt; Bing leaves content it cannot render out of grounding`,
      evidence,
    );
  }
  return pass(
    `all ${assets.size} same-origin scripts and stylesheets may be fetched by Googlebot and Bingbot`,
    evidence,
  );
});
