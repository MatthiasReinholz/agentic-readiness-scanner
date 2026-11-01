import { defineCheck, fail, pass, skip, warn } from '../types.js';
import { scanHead, type HeadScan } from '../../parsers/head.js';
import type { FetchedResponse } from '../../http/types.js';

/** A meta refresh this quick is a redirect, not a page (Google treats 0 s as permanent). */
const REFRESH_REDIRECT_SECONDS = 5;
/** Lighthouse's rule: a charset declaration counts when it starts within the first 1024 bytes. */
const CHARSET_WINDOW = 1024;

interface PageHead {
  status: number;
  content_type: string | null;
  doctype: HeadScan['doctype'];
  charset: 'header' | 'meta' | 'late_meta' | 'none';
  invalid_head_element: string | null;
  misplaced: string[];
  meta_refresh_seconds: number | null;
}

function contentTypeOf(response: FetchedResponse): string | null {
  const value = response.headers['content-type'];
  return value ? value.split(';')[0]!.trim().toLowerCase() : null;
}

function describe(response: FetchedResponse): PageHead {
  const scan = scanHead(response.body);
  const header = response.headers['content-type'] ?? '';
  const charset: PageHead['charset'] = /charset\s*=\s*[a-z0-9_:.()-]{2,}/i.test(header)
    ? 'header'
    : scan.charsetOffset === null
      ? 'none'
      : scan.charsetOffset < CHARSET_WINDOW
        ? 'meta'
        : 'late_meta';
  return {
    status: response.status,
    content_type: contentTypeOf(response),
    doctype: scan.doctype,
    charset,
    invalid_head_element: scan.invalidHeadElement
      ? `<${scan.invalidHeadElement.tag}> at byte ${scan.invalidHeadElement.offset}`
      : null,
    misplaced: scan.misplaced.map(
      (m) => `${m.kind} ${m.where === 'body' ? 'in the body' : 'after the invalid element'}`,
    ),
    meta_refresh_seconds: scan.metaRefreshSeconds,
  };
}

export const documentHeadWellFormed = defineCheck('A3.11', async ({ target, fetcher }) => {
  const urls = target.sampled.products.length > 0 ? target.sampled.products : [target.home.url];
  const sampled = target.sampled.products.length > 0 ? 'products' : 'home';
  const pages: Record<string, PageHead> = {};
  let judged = 0;
  for (const url of urls) {
    const response = sampled === 'home' ? target.home : await fetcher.fetch(url);
    if (response.status !== 200 || response.body.trim() === '') continue;
    pages[url] = describe(response);
    judged += 1;
  }
  const evidence = { sampled, pages, total: judged };
  if (judged === 0) return skip('not_applicable', 'no page answered 200 with a body');
  const entries = Object.entries(pages);
  const misplaced = entries.filter(([, p]) => p.misplaced.length > 0);
  const refreshing = entries.filter(
    ([, p]) => p.meta_refresh_seconds !== null && p.meta_refresh_seconds <= REFRESH_REDIRECT_SECONDS,
  );
  const subject = sampled === 'home' ? 'the home page' : `${judged} sampled product page(s)`;
  const plural = sampled !== 'home';
  if (refreshing.length > 0) {
    return fail(
      `${refreshing.length} of ${subject} redirect with a meta refresh of ${refreshing[0]![1].meta_refresh_seconds} s; crawlers treat the page as a redirect, not as content`,
      evidence,
    );
  }
  if (misplaced.length > 0) {
    const [, first] = misplaced[0]!;
    const what = [...new Set(first.misplaced.map((m) => m.split(' ')[0]))].join(', ');
    const culprit = first.invalid_head_element
      ? ` (the head is ended by ${first.invalid_head_element})`
      : '';
    return fail(
      `on ${misplaced.length} of ${subject} the ${what} sit where crawlers do not read them${culprit}`,
      evidence,
    );
  }
  const notHtml = entries.filter(
    ([, p]) => p.content_type !== null && !/^(text\/html|application\/xhtml\+xml)$/.test(p.content_type),
  );
  if (notHtml.length > 0) {
    return warn(
      `${notHtml.length} of ${subject} are served as ${notHtml[0]![1].content_type} instead of text/html`,
      evidence,
    );
  }
  const noDoctype = entries.filter(([, p]) => p.doctype !== 'html').length;
  const noCharset = entries.filter(([, p]) => p.charset === 'none' || p.charset === 'late_meta').length;
  if (noDoctype > 0 || noCharset > 0) {
    const parts: string[] = [];
    if (noDoctype > 0) parts.push(`${noDoctype} lack the HTML doctype`);
    if (noCharset > 0) parts.push(`${noCharset} declare no character encoding within the first 1024 bytes`);
    return warn(`of ${subject}, ${parts.join(' and ')}`, evidence);
  }
  return pass(
    `${subject} ${plural ? 'start' : 'starts'} with the HTML doctype, ${plural ? 'declare their' : 'declares its'} encoding and ${plural ? 'keep' : 'keeps'} title, canonical and directives inside a valid head`,
    evidence,
  );
});
