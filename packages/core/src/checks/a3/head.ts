import { defineCheck, fail, pass, skip, warn } from '../types.js';
import { scanHead, type HeadScan, type MetadataKind } from '../../parsers/head.js';
import type { FetchedResponse } from '../../http/types.js';
import { everyJudgedPage, judgedPages, sampledProductPages } from './index.js';

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
  const type = value?.split(';')[0]?.trim().toLowerCase();
  return type === undefined || type === '' ? null : type;
}

function describe(response: FetchedResponse): { head: PageHead; scan: HeadScan } {
  const scan = scanHead(response.body);
  const header = response.headers['content-type'] ?? '';
  const charset: PageHead['charset'] = /charset\s*=\s*[a-z0-9_:.()-]{2,}/i.test(header)
    ? 'header'
    : scan.charsetOffset === null
      ? 'none'
      : scan.charsetOffset < CHARSET_WINDOW
        ? 'meta'
        : 'late_meta';
  const head: PageHead = {
    status: response.status,
    content_type: contentTypeOf(response),
    doctype: scan.doctype,
    charset,
    invalid_head_element: scan.invalidHeadElement
      ? `<${scan.invalidHeadElement.tag}> at byte ${scan.invalidHeadElement.offset}`
      : null,
    misplaced: scan.misplaced.map(
      (m) =>
        `${m.kind} ${m.where === 'body' ? 'in the body' : 'after the invalid element'} at byte ${m.offset}`,
    ),
    meta_refresh_seconds: scan.metaRefreshSeconds,
  };
  return { head, scan };
}

/** How a message names each piece of metadata, without an article. */
const METADATA_NAMES: Record<MetadataKind, string> = {
  title: '<title>',
  canonical: 'rel=canonical',
  robots: 'robots meta tag',
  description: 'meta description',
  hreflang: 'hreflang alternates',
};

/** "a", "a and b", "a, b and c". */
function listOf(items: string[]): string {
  if (items.length <= 1) return items[0] ?? '';
  return `${items.slice(0, -1).join(', ')} and ${items[items.length - 1] ?? ''}`;
}

function withArticle(tag: string): string {
  return `${/^[aeiou]/i.test(tag) ? 'an' : 'a'} <${tag}>`;
}

/**
 * What sits where on one page: "<title> sits in the body, after an <iframe> at byte
 * 24457", "<title> and rel=canonical sit after a <div> at byte 318 that ends the head".
 */
export function misplacedPhrase(scan: HeadScan): string {
  const kinds = [...new Set(scan.misplaced.map((m) => m.kind))];
  const what = listOf(kinds.map((kind) => METADATA_NAMES[kind]));
  const plural = kinds.length > 1 || kinds[0] === 'hreflang';
  const culprit = scan.invalidHeadElement;
  const after = culprit ? `after ${withArticle(culprit.tag)} at byte ${culprit.offset}` : null;
  const where = scan.misplaced.some((m) => m.where === 'body')
    ? `in the body${after ? `, ${after}` : ''}`
    : after
      ? `${after} that ends the head`
      : 'outside the head';
  return `${what} ${plural ? 'sit' : 'sits'} ${where}`;
}

export const documentHeadWellFormed = defineCheck('A3.11', async ({ target, fetcher }) => {
  const sampled = target.sampled.products.length > 0 ? 'products' : 'home';
  const responses: FetchedResponse[] = [];
  let failed: Record<string, { status: number; failure: string }> = {};
  let note = '';
  if (sampled === 'home') {
    responses.push(target.home);
  } else {
    const judged = await sampledProductPages(target, fetcher);
    if (judged.unavailable) return judged.unavailable;
    ({ failed, note } = judged);
    // Only pages that answered are scanned; the fetcher has their bodies cached.
    for (const page of judged.pages) responses.push(await fetcher.fetch(page.url));
  }
  const pages: Record<string, PageHead> = {};
  const scans = new Map<string, HeadScan>();
  for (const response of responses) {
    if (response.status < 200 || response.status >= 300 || response.body.trim() === '') continue;
    const { head, scan } = describe(response);
    pages[response.url] = head;
    scans.set(response.url, scan);
  }
  const judged = scans.size;
  const evidence = { sampled, pages, total: judged, failed };
  if (judged === 0) {
    return skip(
      'not_applicable',
      `${sampled === 'home' ? 'the home page' : 'no sampled product page'} answered with ${sampled === 'home' ? 'no' : 'a'} body${note}`,
      evidence,
    );
  }
  const entries = Object.entries(pages);
  const refreshing = entries.filter(
    ([, p]) =>
      p.meta_refresh_seconds !== null && p.meta_refresh_seconds <= REFRESH_REDIRECT_SECONDS,
  );
  const firstRefresh = refreshing[0]?.[1];
  if (firstRefresh) {
    const { phrase, plural } = judgedPages(sampled, refreshing.length, judged);
    return fail(
      `${phrase} redirect${plural ? '' : 's'} with a meta refresh of ${firstRefresh.meta_refresh_seconds} s; crawlers treat the page as a redirect, not as content${note}`,
      evidence,
    );
  }
  const misplaced = entries.filter(([, p]) => p.misplaced.length > 0);
  const firstMisplaced = misplaced[0];
  const firstScan = firstMisplaced ? scans.get(firstMisplaced[0]) : undefined;
  if (firstScan) {
    const { phrase } = judgedPages(sampled, misplaced.length, judged);
    const where = misplacedPhrase(firstScan);
    return fail(
      sampled === 'home'
        ? `the home page's ${where}, where crawlers do not read it${note}`
        : `on ${phrase} the ${where}, where crawlers do not read it${note}`,
      evidence,
    );
  }
  const notHtml = entries.filter(
    ([, p]) =>
      p.content_type !== null && !/^(text\/html|application\/xhtml\+xml)$/.test(p.content_type),
  );
  const firstNotHtml = notHtml[0]?.[1];
  if (firstNotHtml) {
    const { phrase, plural } = judgedPages(sampled, notHtml.length, judged);
    return warn(
      `${phrase} ${plural ? 'are' : 'is'} served as ${firstNotHtml.content_type} instead of text/html${note}`,
      evidence,
    );
  }
  const noDoctype = entries.filter(([, p]) => p.doctype !== 'html').length;
  const noCharset = entries.filter(
    ([, p]) => p.charset === 'none' || p.charset === 'late_meta',
  ).length;
  if (noDoctype > 0 || noCharset > 0) {
    const parts: string[] = [];
    if (noDoctype > 0) {
      const { phrase, plural } = judgedPages(sampled, noDoctype, judged);
      parts.push(`${phrase} lack${plural ? '' : 's'} the HTML doctype`);
    }
    if (noCharset > 0) {
      const { phrase, plural } = judgedPages(sampled, noCharset, judged);
      parts.push(
        `${phrase} declare${plural ? '' : 's'} no character encoding within the first 1024 bytes`,
      );
    }
    return warn(`${parts.join(' and ')}${note}`, evidence);
  }
  return pass(
    `${everyJudgedPage(sampled, judged)} starts with the HTML doctype, declares its encoding and keeps title, canonical and directives inside a valid head${note}`,
    evidence,
  );
});
