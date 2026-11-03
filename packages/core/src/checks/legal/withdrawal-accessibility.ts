/**
 * C3 withdrawal, returns and cancellation; C4 accessibility. Accessibility here is the
 * small part of WCAG a static page shows; a pass never means a site is accessible.
 */
import type { Market } from '@agentic-readiness/catalog';

import { attribute, elementText, type HtmlDocument } from '../../parsers/html.js';
import { asString, extractJsonLd, type JsonLdNode } from '../../parsers/jsonld.js';
import {
  ACCESSIBILITY_LABEL,
  CANCELLATION_LABEL,
  OVERLAY_VENDORS,
  vendorsIn,
  officialWithdrawalLanguage,
  SUBSCRIPTION_WORDING,
  WITHDRAWAL_WORDING,
} from '../../parsers/legal.js';
import { readableProductPages } from '../shared.js';
import { fail, pass, skip, warn } from '../types.js';
import { actionLabels, defineLegalCheck, legalPage, MARKET_NAMES, pathname } from './shared.js';

export const euWithdrawalFunction = defineLegalCheck('C3.1', ({ target }) => {
  const labels = actionLabels(target.homeDoc);
  for (const label of labels) {
    const language = officialWithdrawalLanguage(label.text);
    if (language) {
      return pass(
        `the withdrawal function is labelled with the official wording ("${label.text}")`,
        {
          label: label.text,
          language,
          href: label.href ?? null,
        },
      );
    }
  }
  const similar = labels.find((label) => WITHDRAWAL_WORDING.test(label.text));
  if (similar) {
    return warn(
      `a withdrawal link is labelled "${similar.text}", not with the official wording. The label must be unambiguous`,
      { label: similar.text, href: similar.href ?? null },
    );
  }
  return fail('no withdrawal function linked from the home page');
});

/** Text of the home page and sampled product pages, for "does it sell subscriptions". */
async function sellsSubscriptions(context: Parameters<Parameters<typeof defineLegalCheck>[1]>[0]) {
  const { target, fetcher } = context;
  const { pages } = await readableProductPages(target, fetcher);
  const docs: HtmlDocument[] = [target.homeDoc, ...pages.map((page) => page.doc)];
  for (const doc of docs) {
    const text = doc.text();
    const match = SUBSCRIPTION_WORDING.exec(text);
    if (match) return match[0];
    const billing = /"billingDuration"/.exec(JSON.stringify(extractJsonLd(doc).nodes));
    if (billing) return 'billingDuration in price markup';
  }
  return null;
}

export const argentinaButtons = defineLegalCheck('C3.2', async (context) => {
  const labels = actionLabels(context.target.homeDoc);
  const withdrawal = labels.find((label) => /arrepentimiento/i.test(label.text));
  const cancellation = labels.find((label) => /\bbaja\b/i.test(label.text));
  const subscriptions = await sellsSubscriptions(context);
  const evidence = {
    arrepentimiento: withdrawal?.text ?? null,
    baja: cancellation?.text ?? null,
    subscriptions: subscriptions ?? null,
  };
  if (withdrawal && (cancellation || !subscriptions)) {
    return pass(
      cancellation
        ? 'the home page shows the botón de arrepentimiento and the botón de baja'
        : 'the home page shows the botón de arrepentimiento (no subscription or service offer seen, so no botón de baja is expected)',
      evidence,
    );
  }
  if (withdrawal || cancellation) {
    return warn(
      withdrawal
        ? `the home page shows the botón de arrepentimiento but no botón de baja, although it offers "${subscriptions ?? ''}"`
        : 'the home page shows a botón de baja but no botón de arrepentimiento',
      evidence,
    );
  }
  return fail('no botón de arrepentimiento on the home page', evidence);
});

/** Statutory minimum withdrawal period per market, in days (Colombia: business days). */
const STATUTORY_DAYS: Partial<Record<Market, number>> = {
  EU: 14,
  UK: 14,
  AR: 10,
  CL: 10,
  BR: 7,
  CO: 5,
};

const DAYS_PATTERN =
  /(\d{1,3})\s?(?:-|‑)?\s?(?:calendar |business |working )?(?:days?|tage[n]?|werktage[n]?|kalendertage[n]?|d(?:í|i)as(?: h(?:á|a)biles| corridos)?|jours|giorni|dagen|dage|dagar|päivää|dni|dias)\b/gi;

function returnDaysFromMarkup(nodes: readonly JsonLdNode[]): number[] {
  const days: number[] = [];
  const visit = (value: unknown): void => {
    if (Array.isArray(value)) {
      value.forEach(visit);
      return;
    }
    if (!value || typeof value !== 'object') return;
    for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
      if (key === 'merchantReturnDays') {
        const number = Number(asString(child) ?? child);
        if (Number.isFinite(number) && number > 0) days.push(number);
      } else visit(child);
    }
  };
  visit(nodes);
  return days;
}

export const statutoryReturnPeriod = defineLegalCheck(
  'C3.3',
  async ({ target, fetcher }, markets) => {
    const required = markets
      .map((market) => ({ market, days: STATUTORY_DAYS[market] }))
      .filter((item): item is { market: Market; days: number } => item.days !== undefined);
    const page = await legalPage(target, fetcher, 'returns');
    const { pages } = await readableProductPages(target, fetcher);
    const markup = returnDaysFromMarkup(
      [target.homeDoc, ...pages.map((p) => p.doc)].flatMap((doc) => extractJsonLd(doc).nodes),
    );
    const stated = page?.readable
      ? [...page.text.matchAll(DAYS_PATTERN)]
          .map((match) => Number(match[1]))
          .filter((n) => n > 0 && n <= 365)
      : [];
    const all = [...markup, ...stated];
    const longest = all.length > 0 ? Math.max(...all) : null;
    const strictest = required.reduce((max, item) => Math.max(max, item.days), 0);
    const evidence = {
      returns_page: page ? { url: page.url, status: page.response.status } : null,
      merchant_return_days: markup,
      stated_days: [...new Set(stated)].slice(0, 10),
      required: required.map((item) => ({ market: item.market, days: item.days })),
    };
    if (longest === null) {
      return warn(
        page
          ? `the returns policy at ${page.url} states no period in days`
          : 'no returns policy found to read a period from',
        evidence,
      );
    }
    const short = required.filter((item) => longest < item.days);
    if (short.length > 0) {
      return fail(
        `the longest period stated is ${longest} days, below ${short.map((item) => `${item.days} days in ${MARKET_NAMES[item.market]}`).join(' and ')}`,
        evidence,
      );
    }
    return pass(
      `a period of ${longest} days is stated, at least the ${strictest} days the detected markets grant`,
      evidence,
    );
  },
);

export const subscriptionCancellation = defineLegalCheck('C3.4', async (context) => {
  const subscriptions = await sellsSubscriptions(context);
  if (!subscriptions) return skip('not_applicable', 'no subscription offer seen on the pages read');
  const label = actionLabels(context.target.homeDoc).find((item) =>
    CANCELLATION_LABEL.test(item.text),
  );
  const terms = await legalPage(context.target, context.fetcher, 'terms');
  const inTerms = terms?.readable ? (CANCELLATION_LABEL.exec(terms.text)?.[0] ?? null) : null;
  const evidence = { offer: subscriptions, link: label?.text ?? null, terms: inTerms };
  if (label) return pass(`the store offers "${subscriptions}" and links "${label.text}"`, evidence);
  if (inTerms)
    return warn(
      `the store offers "${subscriptions}" and the terms mention "${inTerms}", but no cancellation link is on the home page`,
      evidence,
    );
  return warn(
    `the store offers "${subscriptions}" but no online cancellation route is linked`,
    evidence,
  );
});

export const accessibilityStatement = defineLegalCheck('C4.1', ({ target }) => {
  const anchor = target.homeDoc
    .anchors()
    .find(
      (item) =>
        ACCESSIBILITY_LABEL.test(item.text) ||
        ACCESSIBILITY_LABEL.test(pathname(item.href, target.origin).replace(/[-_/]/g, ' ')),
    );
  if (anchor)
    return pass(`the home page links "${anchor.text || anchor.href}"`, {
      href: anchor.href,
      label: anchor.text,
    });
  const symbol = actionLabels(target.homeDoc).find((item) =>
    /acessibilidade|accessibility symbol/i.test(item.text),
  );
  if (symbol) return pass(`the home page shows "${symbol.text}"`, { label: symbol.text });
  return fail('no accessibility statement linked from the home page');
});

interface PageFindings {
  url: string;
  problems: Record<string, number | string>;
}

const LABELLED_INPUT_TYPES = /^(?:hidden|submit|reset|button|image)$/i;

/** The static accessibility basics of one page. */
export function accessibilityFindings(doc: HtmlDocument, url: string): PageFindings {
  const problems: Record<string, number | string> = {};
  if (!doc.lang()) problems.lang = 'no lang attribute on the html element';
  if (!doc.title()) problems.title = 'no title';
  const images = doc.elements('img').filter((image) => {
    if (attribute(image, 'alt') !== undefined) return false;
    if (
      (attribute(image, 'role') ?? '') === 'presentation' ||
      attribute(image, 'aria-hidden') === 'true'
    )
      return false;
    return true;
  });
  if (images.length > 0) problems.images_without_alt = images.length;
  const labelled = new Set(
    doc
      .elements('label')
      .map((label) => attribute(label, 'for'))
      .filter((value): value is string => Boolean(value)),
  );
  const unlabelled = [
    ...doc.elements('input'),
    ...doc.elements('select'),
    ...doc.elements('textarea'),
  ].filter((control) => {
    if (control.name === 'input' && LABELLED_INPUT_TYPES.test(attribute(control, 'type') ?? ''))
      return false;
    if (
      attribute(control, 'aria-label') ||
      attribute(control, 'aria-labelledby') ||
      attribute(control, 'title')
    )
      return false;
    const id = attribute(control, 'id');
    if (id && labelled.has(id)) return false;
    let parent = control.parent;
    while (parent && 'name' in parent) {
      if (parent.name === 'label') return false;
      parent = parent.parent;
    }
    return true;
  });
  if (unlabelled.length > 0) problems.unlabelled_controls = unlabelled.length;
  const nameless = [...doc.elements('a'), ...doc.elements('button')].filter((element) => {
    if (element.name === 'a' && attribute(element, 'href') === undefined) return false;
    if (elementText(element).trim()) return false;
    if (
      attribute(element, 'aria-label') ||
      attribute(element, 'aria-labelledby') ||
      attribute(element, 'title')
    )
      return false;
    const imageAlt = doc
      .elements('img')
      .some((image) => (attribute(image, 'alt') ?? '').trim() !== '' && isInside(image, element));
    return !imageAlt;
  });
  if (nameless.length > 0) problems.unnamed_links_and_buttons = nameless.length;
  const viewport = doc.meta('viewport') ?? '';
  const scale = /maximum-scale\s*=\s*([\d.]+)/i.exec(viewport)?.[1];
  if (
    /user-scalable\s*=\s*(?:no|0)/i.test(viewport) ||
    (scale !== undefined && Number(scale) < 2)
  ) {
    problems.zoom_disabled = viewport;
  }
  return { url, problems };
}

function isInside(node: { parent: unknown }, ancestor: unknown): boolean {
  let current = node.parent as { parent: unknown } | null;
  while (current) {
    if (current === ancestor) return true;
    current = (current.parent as { parent: unknown } | null) ?? null;
  }
  return false;
}

export const staticAccessibilityBasics = defineLegalCheck('C4.2', async ({ target, fetcher }) => {
  const { pages } = await readableProductPages(target, fetcher);
  const findings = [
    accessibilityFindings(target.homeDoc, target.home.finalUrl),
    ...pages.map((page) => accessibilityFindings(page.doc, page.url)),
  ];
  const failing = findings.filter((page) => Object.keys(page.problems).length > 0);
  const evidence = { pages: findings };
  if (failing.length === 0) {
    return pass(
      `${findings.length} page(s) pass the static basics (language, title, alt text, labels, names, zoom). Contrast, keyboard and focus were not checked`,
      evidence,
    );
  }
  const kinds = [...new Set(failing.flatMap((page) => Object.keys(page.problems)))].map((key) =>
    key.replace(/_/g, ' '),
  );
  const heavy = failing.filter((page) => Object.keys(page.problems).length >= 3).length;
  const message = `${failing.length} of ${findings.length} page(s) miss basics: ${kinds.join(', ')}`;
  return heavy * 2 > findings.length ? fail(message, evidence) : warn(message, evidence);
});

export const accessibilityOverlay = defineLegalCheck('C4.3', ({ target }) => {
  const vendors = vendorsIn(
    target.homeDoc.externalScripts(),
    target.homeDoc.inlineScripts(),
    OVERLAY_VENDORS,
  );
  if (vendors.length > 0) {
    return warn(
      `the home page loads an accessibility overlay (${vendors.join(', ')}). An overlay does not make a site conformant`,
      { vendors },
    );
  }
  return pass('no accessibility overlay detected');
});
