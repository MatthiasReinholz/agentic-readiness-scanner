import { contentType } from '../../http/types.js';
import { hasLinkRelation, parseLinkHeader } from '../../parsers/link-header.js';
import type { Target } from '../../target/types.js';
import { parseJson } from '../json.js';
import { blockedByRobots, describeFailure } from '../shared.js';
import { defineCheck, fail, pass, skip, warn } from '../types.js';
import { homeNoindex, homeRobotsDirectives, isTransient, transientPhrase } from './shared.js';

const API_RELATION = 'https://api.w.org/';

/**
 * The REST API root the site advertises (the rel="https://api.w.org/" link in the head
 * or the Link header), else the default /wp-json/. WordPress documents both.
 */
export function restApiRoot(target: Target): { root: string; advertised: boolean } {
  const fromHead = target.homeDoc.links().find((link) => link.rel === API_RELATION)?.href;
  const fromHeader = parseLinkHeader(target.home.headers.link).find((link) =>
    hasLinkRelation(link, API_RELATION),
  )?.href;
  const href = fromHead ?? fromHeader;
  if (href) {
    try {
      const url = new URL(href, target.origin);
      if (url.origin === target.origin) return { root: url.href, advertised: true };
    } catch {
      // fall through to the default
    }
  }
  return { root: `${target.origin}/wp-json/`, advertised: false };
}

/** A route under the root, for both the pretty /wp-json/ form and the ?rest_route= form. */
export function restRoute(root: string, route: string, query: Record<string, string>): string {
  const url = new URL(root);
  if (url.searchParams.has('rest_route')) {
    url.searchParams.set('rest_route', `/${route}`);
  } else {
    url.pathname = `${url.pathname.replace(/\/?$/, '/')}${route}`;
  }
  for (const [key, value] of Object.entries(query)) url.searchParams.set(key, value);
  return url.href;
}

export const wordpressRestApiReadable = defineCheck('A4.7', async ({ target, fetcher }) => {
  const { root, advertised } = restApiRoot(target);
  const url = restRoute(root, 'wp/v2/pages', { per_page: '1', _fields: 'id,link' });
  const response = await fetcher.fetch(url, { headers: { accept: 'application/json' } });
  const evidence: Record<string, unknown> = {
    root,
    advertised,
    url,
    status: response.status,
    content_type: contentType(response),
  };
  if (blockedByRobots(response)) {
    return warn(
      `the REST API was not requested because robots.txt disallows ${new URL(url).pathname} for the scanner; whether agents can read it could not be verified`,
      evidence,
    );
  }
  if (isTransient(response)) {
    return skip('error', `the REST API request ${transientPhrase(response)}`, evidence);
  }
  const body = parseJson(response.body);
  if (response.status === 200 && Array.isArray(body)) {
    return pass(
      `the REST API answers without signing in (${body.length === 0 ? 'no published pages' : 'published pages are listed'})`,
      evidence,
    );
  }
  const code =
    typeof body === 'object' && body !== null && 'code' in body ? String(body.code) : null;
  evidence.code = code;
  if (response.status === 401 || response.status === 403) {
    return fail(
      `the REST API refuses anonymous reads (${describeFailure(response)}${code ? `, ${code}` : ''}); a security plugin or a filter usually does this`,
      evidence,
    );
  }
  if (response.status === 404) {
    return fail(
      `the REST API is not served at ${root} (HTTP 404)${advertised ? ' although the page advertises it' : ''}`,
      evidence,
    );
  }
  return fail(
    `the REST API did not answer with JSON (${describeFailure(response)}, ${contentType(response) || 'no content type'})`,
    evidence,
  );
});

/** What WordPress prints when Settings > Reading > Search engine visibility is ticked. */
const CORE_NO_ROBOTS = /^\s*noindex,\s*nofollow\s*$/i;

export const wordpressSearchVisibility = defineCheck('A2.8', ({ target }) => {
  const directives = homeRobotsDirectives(target);
  const evidence = { robots_meta: directives.meta, x_robots_tag: directives.header };
  if (!homeNoindex(target)) {
    return pass('the home page does not ask search engines to stay away', evidence);
  }
  const core = CORE_NO_ROBOTS.test(directives.meta ?? '');
  return fail(
    core
      ? 'the home page carries "noindex, nofollow", the tag WordPress prints when Settings > Reading > Search engine visibility is ticked'
      : 'the home page carries noindex; check Settings > Reading > Search engine visibility and any SEO plugin',
    { ...evidence, core_setting: core },
  );
});
