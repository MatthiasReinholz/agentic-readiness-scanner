/**
 * Helpers the legal-signals checks share: the market gate, the pages a legal check reads
 * (home, identity, privacy, terms, returns) and small text utilities. Pages come through
 * the Fetcher, so a page another check already read costs no request.
 */
import type { Market } from '@agentic-readiness/catalog';
import { isTag } from 'domhandler';

import type { FetchedResponse, Fetcher } from '../../http/types.js';
import { attribute, elementText, HtmlDocument } from '../../parsers/html.js';
import type { Target } from '../../target/types.js';
import { describeFailure } from '../shared.js';
import { defineCheck, skip, type Check, type CheckContext, type CheckOutcome } from '../types.js';

export const MARKET_NAMES: Readonly<Record<Market, string>> = {
  EU: 'the EU',
  UK: 'the UK',
  CH: 'Switzerland',
  US: 'the United States',
  CA: 'Canada',
  AU: 'Australia',
  BR: 'Brazil',
  AR: 'Argentina',
  CL: 'Chile',
  CO: 'Colombia',
  PE: 'Peru',
};

/** The markets of this target that the check is about; all of them when it names none. */
export function relevantMarkets(target: Target, markets: readonly Market[]): Market[] {
  const detected = target.markets ?? [];
  return markets.length === 0
    ? [...detected]
    : detected.filter((market) => markets.includes(market));
}

/**
 * A legal check that runs only for stores that appear to sell to one of its markets. The
 * skip names the markets so the report can say how to include them.
 */
export function defineLegalCheck(
  id: string,
  run: (context: CheckContext, markets: Market[]) => CheckOutcome | Promise<CheckOutcome>,
): Check {
  return defineCheck(id, async (context) => {
    const wanted = context.definition.markets;
    const markets = relevantMarkets(context.target, wanted);
    if (wanted.length > 0 && markets.length === 0) {
      const names = wanted.map((market) => MARKET_NAMES[market]);
      return skip(
        'not_applicable',
        `no sign this store sells to ${names.length > 1 ? `${names.slice(0, -1).join(', ')} or ${names[names.length - 1] ?? ''}` : (names[0] ?? '')}. Choose markets to include it`,
        { markets_wanted: wanted },
      );
    }
    return run(context, markets);
  });
}

export interface LegalPage {
  kind: 'home' | 'imprint' | 'contact' | 'privacy' | 'terms' | 'returns';
  url: string;
  response: FetchedResponse;
  doc: HtmlDocument;
  text: string;
  readable: boolean;
}

/** One of the pages a legal check reads, fetched through the cache; null when not found. */
export async function legalPage(
  target: Target,
  fetcher: Fetcher,
  kind: LegalPage['kind'],
): Promise<LegalPage | null> {
  if (kind === 'home') {
    return {
      kind,
      url: target.home.finalUrl,
      response: target.home,
      doc: target.homeDoc,
      text: target.homeDoc.text(),
      readable: true,
    };
  }
  const url = target.sampled.policies[kind];
  if (!url) return null;
  const response = await fetcher.fetch(url);
  const readable = response.status >= 200 && response.status < 300;
  const doc = new HtmlDocument(readable ? response.body : '');
  return { kind, url, response, doc, text: readable ? doc.text() : '', readable };
}

export async function legalPages(
  target: Target,
  fetcher: Fetcher,
  kinds: readonly LegalPage['kind'][],
): Promise<LegalPage[]> {
  const pages: LegalPage[] = [];
  for (const kind of kinds) {
    const page = await legalPage(target, fetcher, kind);
    if (page) pages.push(page);
  }
  return pages;
}

export function unreadable(page: LegalPage): string {
  return `${page.url} (${describeFailure(page.response)})`;
}

/** Labels of links and buttons, with image alt and title text, for wording matches. */
export function actionLabels(doc: HtmlDocument): { text: string; href?: string }[] {
  const labels: { text: string; href?: string }[] = [];
  for (const element of doc.elements('a')) {
    const images = element.children
      .filter(isTag)
      .filter((child) => child.name === 'img')
      .map((child) => attribute(child, 'alt') ?? '');
    const text = [
      elementText(element),
      attribute(element, 'aria-label') ?? '',
      attribute(element, 'title') ?? '',
      ...images,
    ]
      .join(' ')
      .replace(/\s+/g, ' ')
      .trim();
    const href = attribute(element, 'href');
    labels.push({ text, ...(href ? { href } : {}) });
  }
  for (const control of doc.controls()) {
    labels.push({ text: [control.text, control.value ?? ''].join(' ').trim() });
  }
  for (const image of doc.elements('img')) {
    const alt = attribute(image, 'alt');
    if (alt) labels.push({ text: alt });
  }
  return labels;
}

/** A short quote around a match, for evidence. */
export function excerpt(text: string, index: number, length: number, radius = 60): string {
  const start = Math.max(0, index - radius);
  const end = Math.min(text.length, index + length + radius);
  return `${start > 0 ? '…' : ''}${text.slice(start, end).trim()}${end < text.length ? '…' : ''}`;
}

/** The path of a URL, or the input when it is not one. */
export function pathname(href: string, base: string): string {
  try {
    return new URL(href, base).pathname;
  } catch {
    return href;
  }
}
