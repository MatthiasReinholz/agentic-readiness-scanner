/**
 * C5 product and price information; C6 AI transparency and content rights. Product
 * checks read the sampled product pages the readiness checks already fetched.
 */
import { SEARCH_CRAWLERS, TRAINING_CRAWLERS } from '../crawlers.js';
import { elementText, type HtmlDocument } from '../../parsers/html.js';
import { asString, extractJsonLd, productNodes, type JsonLdNode } from '../../parsers/jsonld.js';
import {
  CHAT_VENDORS,
  EMAIL_PATTERN,
  GENERIC_GREEN_CLAIMS,
  MANUFACTURER_WORDING,
  POSTAL_ADDRESS_PATTERN,
  PRIOR_PRICE_WORDING,
  REVIEW_VERIFICATION_WORDING,
  REVIEW_WIDGETS,
  SWISS_VAT_INCLUDED,
} from '../../parsers/legal.js';
import { isAllowed } from '../../parsers/robots.js';
import { parseTdmrepJson } from '../../parsers/usage-preferences.js';
import { readableProductPages } from '../shared.js';
import { fail, pass, skip, warn } from '../types.js';
import { defineLegalCheck, excerpt, legalPage } from './shared.js';

function manufacturerNode(nodes: readonly JsonLdNode[]): { name: string | null; contact: boolean } {
  for (const product of productNodes([...nodes])) {
    const value: unknown = product.manufacturer;
    const node: unknown = Array.isArray(value) ? (value as unknown[])[0] : value;
    if (typeof node === 'string') return { name: node, contact: false };
    if (node && typeof node === 'object') {
      const record = node as JsonLdNode;
      return {
        name: asString(record.name) ?? asString(record.legalName),
        contact:
          Boolean(record.address) ||
          asString(record.email) !== null ||
          asString(record.url) !== null,
      };
    }
  }
  return { name: null, contact: false };
}

export const manufacturerInformation = defineLegalCheck('C5.1', async ({ target, fetcher }) => {
  const { pages, unavailable } = await readableProductPages(target, fetcher);
  if (unavailable) return unavailable;
  const findings = pages.map((page) => {
    const markup = manufacturerNode(extractJsonLd(page.doc).nodes);
    const text = page.doc.text();
    const wording = MANUFACTURER_WORDING.exec(text);
    const near = wording ? text.slice(wording.index, wording.index + 400) : '';
    const contact =
      markup.contact ||
      (wording !== null && (EMAIL_PATTERN.test(near) || POSTAL_ADDRESS_PATTERN.test(near)));
    return { url: page.url, manufacturer: markup.name ?? wording?.[0] ?? null, contact };
  });
  const complete = findings.filter((item) => item.manufacturer && item.contact);
  const named = findings.filter((item) => item.manufacturer);
  const evidence = { pages: findings };
  if (complete.length === findings.length) {
    return pass(
      `all ${findings.length} sampled product page(s) name a manufacturer with contact details`,
      evidence,
    );
  }
  if (named.length === 0) return fail('no sampled product page names a manufacturer', evidence);
  return warn(
    `${named.length} of ${findings.length} sampled page(s) name a manufacturer, ${complete.length} with a postal or electronic address`,
    evidence,
  );
});

/** True when the page shows a struck-through price or a strikethrough price in markup. */
function showsDiscount(doc: HtmlDocument): boolean {
  const struck = [...doc.elements('del'), ...doc.elements('s'), ...doc.elements('strike')].some(
    (element) => /\d/.test(elementText(element)),
  );
  if (struck) return true;
  return /StrikethroughPrice|"priceType"\s*:\s*"[^"]*ListPrice/i.test(
    JSON.stringify(extractJsonLd(doc).nodes),
  );
}

export const priorLowestPrice = defineLegalCheck('C5.2', async ({ target, fetcher }) => {
  const { pages, unavailable } = await readableProductPages(target, fetcher);
  if (unavailable) return unavailable;
  const discounted = pages.filter((page) => showsDiscount(page.doc));
  if (discounted.length === 0)
    return skip('not_applicable', 'no reduced price shown on the sampled product pages');
  const findings = discounted.map((page) => ({
    url: page.url,
    prior_price_wording: PRIOR_PRICE_WORDING.exec(page.doc.text())?.[0] ?? null,
  }));
  const missing = findings.filter((item) => !item.prior_price_wording);
  if (missing.length === 0)
    return pass(`every reduced price states the lowest price of the previous 30 days`, {
      pages: findings,
    });
  return warn(
    `${missing.length} of ${findings.length} page(s) with a reduced price state no 30-day lowest price`,
    { pages: findings },
  );
});

function hasReviews(doc: HtmlDocument): boolean {
  const markup = JSON.stringify(extractJsonLd(doc).nodes);
  if (/"aggregateRating"|"@type"\s*:\s*"Review"/i.test(markup)) return true;
  return [...doc.externalScripts(), ...doc.inlineScripts()].some((source) =>
    REVIEW_WIDGETS.test(source),
  );
}

export const reviewVerification = defineLegalCheck('C5.3', async ({ target, fetcher }) => {
  const { pages } = await readableProductPages(target, fetcher);
  const docs = [
    { url: target.home.finalUrl, doc: target.homeDoc },
    ...pages.map((page) => ({ url: page.url, doc: page.doc })),
  ];
  const withReviews = docs.filter((item) => hasReviews(item.doc));
  if (withReviews.length === 0) return skip('not_applicable', 'no reviews seen on the pages read');
  const terms = await legalPage(target, fetcher, 'terms');
  const texts = [...docs.map((item) => item.doc.text()), terms?.readable ? terms.text : ''];
  const statement =
    texts.map((text) => REVIEW_VERIFICATION_WORDING.exec(text)?.[0]).find(Boolean) ?? null;
  const evidence = { pages_with_reviews: withReviews.map((item) => item.url), statement };
  if (statement) return pass(`reviews are shown and the pages say "${statement}"`, evidence);
  return warn('reviews are shown but the pages read do not say how they are checked', evidence);
});

export const genericGreenClaims = defineLegalCheck('C5.4', async ({ target, fetcher }) => {
  const { pages } = await readableProductPages(target, fetcher);
  const docs = [
    { url: target.home.finalUrl, doc: target.homeDoc },
    ...pages.map((page) => ({ url: page.url, doc: page.doc })),
  ];
  const claims = docs.flatMap((item) => {
    const text = item.doc.text();
    const match = GENERIC_GREEN_CLAIMS.exec(text);
    return match
      ? [{ url: item.url, claim: match[0], context: excerpt(text, match.index, match[0].length) }]
      : [];
  });
  if (claims.length > 0) {
    return warn(
      `generic environmental claim(s) to substantiate: ${[...new Set(claims.map((item) => `"${item.claim}"`))].join(', ')}`,
      { claims },
    );
  }
  return pass('no generic environmental claim on the pages read');
});

export const swissPriceDisplay = defineLegalCheck('C5.5', async ({ target, fetcher }) => {
  const { pages, unavailable } = await readableProductPages(target, fetcher);
  if (unavailable) return unavailable;
  const findings = pages.map((page) => {
    const markup = JSON.stringify(extractJsonLd(page.doc).nodes);
    const text = page.doc.text();
    return {
      url: page.url,
      chf: /"priceCurrency"\s*:\s*"CHF"/i.test(markup) || /\b(?:CHF|Fr\.)\s?\d/.test(text),
      vat_included: SWISS_VAT_INCLUDED.exec(text)?.[0] ?? null,
    };
  });
  const evidence = { pages: findings };
  if (!findings.some((item) => item.chf))
    return fail('no price in Swiss francs on the sampled product pages', evidence);
  if (findings.every((item) => item.chf && item.vat_included))
    return pass('prices are in CHF with VAT stated as included', evidence);
  return warn('prices are in CHF but not every page states that VAT is included', evidence);
});

export const aiChatAssistant = defineLegalCheck('C6.1', ({ target }) => {
  const sources = [...target.homeDoc.externalScripts(), ...target.homeDoc.inlineScripts()].join(
    '\n',
  );
  const vendors = CHAT_VENDORS.filter((vendor) => vendor.pattern.test(sources)).map(
    (vendor) => vendor.name,
  );
  if (vendors.length > 0) {
    return warn(
      `the home page loads a chat assistant (${vendors.join(', ')}); if it answers with AI, users must be told, which happens inside the widget and cannot be checked`,
      { vendors },
    );
  }
  return pass('no chat or AI assistant widget detected in the static HTML');
});

const TERMS_RESERVATION =
  /text (?:and|&) data mining|data mining|\bTDM\b|§\s?44b|Art(?:icle|\.)\s?4\s?\(3\)|machine learning|AI training|KI-Training/i;

export const tdmReservation = defineLegalCheck('C6.2', async ({ target, fetcher }) => {
  const robots = target.robots;
  const blockedTraining = robots
    ? TRAINING_CRAWLERS.filter((token) => !isAllowed(robots, token, '/'))
    : [];
  const usage =
    robots?.usageLines.filter((line) => line.field === 'content-usage').map((line) => line.value) ??
    [];
  const tdmrepResponse = await fetcher.fetch(`${target.origin}/.well-known/tdmrep.json`);
  const tdmrep = tdmrepResponse.status === 200 ? parseTdmrepJson(tdmrepResponse.body) : null;
  const header = target.home.headers['tdm-reservation'] ?? target.homeDoc.meta('tdm-reservation');
  const terms = await legalPage(target, fetcher, 'terms');
  const termsWording = terms?.readable ? (TERMS_RESERVATION.exec(terms.text)?.[0] ?? null) : null;
  const productPath = (() => {
    const first = target.sampled.products[0];
    if (!first) return '/';
    try {
      return new URL(first).pathname;
    } catch {
      return '/';
    }
  })();
  const blockedSearch = robots
    ? SEARCH_CRAWLERS.filter((crawler) => !isAllowed(robots, crawler.token, productPath)).map(
        (crawler) => crawler.token,
      )
    : [];
  const machineReadable =
    blockedTraining.length > 0 || usage.length > 0 || tdmrep?.kind === 'valid' || header === '1';
  const evidence = {
    robots_training_blocked: blockedTraining,
    content_usage: usage,
    tdmrep: tdmrep ? tdmrep.kind : tdmrepResponse.status,
    tdm_reservation_header: header ?? null,
    terms_wording: termsWording,
    search_crawlers_blocked: blockedSearch,
  };
  if (machineReadable && blockedSearch.length > 0) {
    return warn(
      `text and data mining is reserved, but robots.txt also keeps ${blockedSearch.join(', ')} from product pages, which removes the store from the answers they feed`,
      evidence,
    );
  }
  if (machineReadable) {
    const how = [
      blockedTraining.length > 0 ? `robots.txt disallows ${blockedTraining.join(', ')}` : '',
      usage.length > 0 ? 'Content-Usage lines' : '',
      tdmrep?.kind === 'valid' ? '/.well-known/tdmrep.json' : '',
      header === '1' ? 'a tdm-reservation signal' : '',
    ].filter(Boolean);
    return pass(
      `machine-readable reservation in place (${how.join('; ')}); search crawlers can still read product pages`,
      evidence,
    );
  }
  if (termsWording) {
    return warn(
      `the terms mention "${termsWording}" but nothing machine-readable reserves text and data mining; terms-only reservations were held not machine-readable in 2025`,
      evidence,
    );
  }
  return pass('nothing reserves text and data mining; reserving is a right, not a duty', evidence);
});

/** IPTC and C2PA markers of AI generation in image bytes read as text. */
const AI_IMAGE_MARKERS =
  /trainedAlgorithmicMedia|compositeWithTrainedAlgorithmicMedia|c2pa\.ai_generated|c2pa\.actions/i;
const C2PA_MANIFEST = /c2pa|jumbf/i;

export const aiImageMarking = defineLegalCheck('C6.3', async ({ target, fetcher }) => {
  const { pages, unavailable } = await readableProductPages(target, fetcher);
  if (unavailable) return unavailable;
  const images = pages
    .map((page) => page.doc.productImage(page.url)?.src ?? null)
    .filter((url): url is string => url !== null)
    .slice(0, 2);
  if (images.length === 0) return skip('not_applicable', 'no product image found to read');
  const findings = [];
  for (const url of images) {
    const response = await fetcher.fetch(url);
    const body = response.status === 200 ? response.body : '';
    findings.push({
      url,
      status: response.status,
      ai_marker: AI_IMAGE_MARKERS.exec(body)?.[0] ?? null,
      c2pa: C2PA_MANIFEST.test(body),
    });
  }
  const marked = findings.filter((item) => item.ai_marker);
  if (marked.length > 0) {
    return pass(
      `${marked.length} product image(s) declare AI generation (${marked[0]?.ai_marker ?? ''})`,
      { images: findings },
    );
  }
  return skip(
    'not_applicable',
    `no AI-generation metadata in ${findings.length} product image(s); missing metadata does not show an image is camera-made`,
    { images: findings },
  );
});
