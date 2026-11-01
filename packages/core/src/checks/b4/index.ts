import { contentType } from '../../http/types.js';
import { HtmlDocument } from '../../parsers/html.js';
import { asString, extractJsonLd, hasValue, organizationNodes } from '../../parsers/jsonld.js';
import { isAllowed } from '../../parsers/robots.js';
import { parseSecurityTxt } from '../../parsers/security-txt.js';
import { SEARCH_CRAWLERS } from '../a2/index.js';
import { describeFailure, hasProductMarkup, pathOf } from '../shared.js';
import { registrableDomain } from '../../http/domain.js';
import { looksLikeProductUrl } from '../../parsers/sitemap.js';
import { ACCOUNT_AREA_PATTERN, isListingPath } from '../../target/resolver.js';
import { defineCheck, fail, outcomeForRatio, pass, skip, warn } from '../types.js';

/**
 * Signs that a shipping page states concrete terms: an amount with a currency, a
 * delivery time in days, or a well-known keyword. Each alternative has bounded
 * repetitions so matching stays linear on long numeric pages; the text is capped too.
 */
const SHIPPING_AMOUNT =
  /(?:\d{1,3}(?:[.,]\d{3}){1,4}|\d{1,7})(?:[.,]\d{1,2})?\s?(?:[€$£]|(?:eur|usd|gbp|chf)\b)|[€$£]\s?\d/i;
const SHIPPING_DAYS =
  /\b\d{1,3}(?:\s?(?:-|–|to|bis)\s?\d{1,3})?\s?(?:business days|working days|days|tage|werktage|jours)\b/i;
const SHIPPING_KEYWORDS =
  /free shipping|kostenlos|versandkosten|versandkostenfrei|delivery time|lieferzeit|worldwide|europe|international/i;
const SHIPPING_TEXT_LIMIT = 50_000;

export function hasShippingDetails(text: string): boolean {
  const sample = text.slice(0, SHIPPING_TEXT_LIMIT);
  return (
    SHIPPING_KEYWORDS.test(sample) || SHIPPING_AMOUNT.test(sample) || SHIPPING_DAYS.test(sample)
  );
}

export const returnPolicyFound = defineCheck('B4.1', async ({ target, fetcher }) => {
  const url = target.sampled.policies.returns;
  if (!url)
    return fail('no return or refund policy link found on the homepage', {
      candidates: target.sampled.policies,
    });
  const response = await fetcher.fetch(url);
  const doc = new HtmlDocument(response.body);
  const words = doc.wordCount();
  const productPage = response.status === 200 && hasProductMarkup(doc);
  const evidence = { url, status: response.status, words, product_page: productPage };
  if (response.status !== 200)
    return fail(`return policy page returned HTTP ${response.status}`, evidence);
  if (productPage)
    return fail(
      `the only link that mentions returns leads to a product page (${url}), not to a return policy`,
      evidence,
    );
  if (words <= 100) return warn(`return policy page is short (${words} words)`, evidence);
  return pass(`return policy at ${url} (${words} words)`, evidence);
});

export const shippingPolicyFound = defineCheck('B4.2', async ({ target, fetcher }) => {
  const url = target.sampled.policies.shipping;
  if (!url)
    return fail('no shipping or delivery policy link found on the homepage', {
      candidates: target.sampled.policies,
    });
  const response = await fetcher.fetch(url);
  const doc = new HtmlDocument(response.body);
  const text = doc.text();
  const mentionsDetails = hasShippingDetails(text);
  const productPage = response.status === 200 && hasProductMarkup(doc);
  const evidence = {
    url,
    status: response.status,
    words: doc.wordCount(),
    mentions_costs_regions_or_times: mentionsDetails,
    product_page: productPage,
  };
  if (response.status !== 200)
    return fail(`shipping policy page returned HTTP ${response.status}`, evidence);
  if (productPage)
    return fail(
      `the only link that mentions shipping leads to a product page (${url}), not to a shipping policy`,
      evidence,
    );
  if (!mentionsDetails)
    return warn('shipping page does not mention regions, costs or delivery times', evidence);
  return pass(`shipping policy at ${url}`, evidence);
});

export const privacyAndTermsFound = defineCheck('B4.3', async ({ target, fetcher }) => {
  const privacyUrl = target.sampled.policies.privacy;
  const termsUrl = target.sampled.policies.terms;
  const evidence: Record<string, unknown> = {
    privacy: privacyUrl ?? null,
    terms: termsUrl ?? null,
  };
  let found = 0;
  const problems: string[] = [];
  for (const [kind, url] of [
    ['privacy', privacyUrl],
    ['terms', termsUrl],
  ] as const) {
    if (!url) {
      problems.push(`no ${kind === 'privacy' ? 'privacy policy' : 'terms'} link on the home page`);
      continue;
    }
    const response = await fetcher.fetch(url);
    evidence[`${kind}_status`] = response.status;
    if (response.status === 200) found += 1;
    else
      problems.push(
        `the ${kind === 'privacy' ? 'privacy policy' : 'terms'} link ${url} answered ${describeFailure(response)}`,
      );
  }
  const detail = problems.length > 0 ? ` (${problems.join('; ')})` : '';
  if (found === 2) return pass('privacy policy and terms pages found and readable', evidence);
  if (found === 1)
    return warn(`only one of privacy policy and terms is readable${detail}`, evidence);
  return fail(`neither privacy policy nor terms page is readable${detail}`, evidence);
});

/** Organization properties that say where the merchant is or how to reach it. */
const ORGANIZATION_DETAILS = ['address', 'contactPoint', 'telephone', 'email'] as const;

interface OrganizationSummary {
  name: string | null;
  /** Present properties among name and the contact details. */
  fields: string[];
  complete: boolean;
}

/** The best Organization node in a document: the one with the most identity fields. */
function organizationIn(doc: HtmlDocument): OrganizationSummary | null {
  let best: OrganizationSummary | null = null;
  for (const node of organizationNodes(extractJsonLd(doc).nodes)) {
    const name = asString(node.name);
    const details = ORGANIZATION_DETAILS.filter((key) => hasValue(node, key));
    const summary: OrganizationSummary = {
      name,
      fields: [...(name ? ['name'] : []), ...details],
      complete: name !== null && details.length > 0,
    };
    if (!best || summary.fields.length > best.fields.length) best = summary;
  }
  return best;
}

/**
 * Postal address signs in page text: a 4–6 digit postal code followed by a word (10115
 * Berlin) and a street-like token, a word of three letters or more followed by a 1–4
 * digit house number (Töpferstraße 12, Main Street 5). Every repetition is bounded so
 * the scan is linear.
 */
const POSTAL_CODE = /\b\d{4,6}\s{1,3}\p{L}{2}/u;
const STREET_NUMBER = /\p{L}{3,40}\.?\s{1,3}\d{1,4}\b/u;
const ADDRESS_TEXT_LIMIT = 50_000;

export function hasPostalAddressText(text: string): { postal_code: boolean; street: boolean } {
  const sample = text.slice(0, ADDRESS_TEXT_LIMIT);
  return { postal_code: POSTAL_CODE.test(sample), street: STREET_NUMBER.test(sample) };
}

interface ImprintEvidence {
  url: string;
  status: number;
  postal_code: boolean;
  street: boolean;
}

export const merchantIdentity = defineCheck('B4.4', async ({ target, fetcher }) => {
  const sources: string[] = [];
  // The best Organization seen so far and the page that carried it.
  const best: { organization: OrganizationSummary | null; url: string | null } = {
    organization: null,
    url: null,
  };
  let imprint: ImprintEvidence | null = null;

  /** Records the document's best Organization; true when it already satisfies the check. */
  const consider = (url: string, doc: HtmlDocument): boolean => {
    sources.push(url);
    const found = organizationIn(doc);
    if (found && (!best.organization || found.fields.length > best.organization.fields.length)) {
      best.organization = found;
      best.url = url;
    }
    return found?.complete ?? false;
  };
  const evidence = (): Record<string, unknown> => ({
    organization: best.organization?.name ?? null,
    fields: best.organization?.fields ?? [],
    source: best.url,
    sources,
    imprint,
  });
  const organizationPass = (): ReturnType<typeof pass> => {
    const details = (best.organization?.fields ?? []).filter((field) => field !== 'name');
    return pass(
      `Organization JSON-LD "${best.organization?.name ?? ''}" with ${details.join(', ')} on ${best.url ?? ''}`,
      evidence(),
    );
  };

  // The home page first: it costs no request and most stores publish their graph there.
  if (consider(target.home.finalUrl, target.homeDoc)) return organizationPass();

  const imprintUrl = target.sampled.policies.imprint;
  if (imprintUrl) {
    const response = await fetcher.fetch(imprintUrl);
    const doc = new HtmlDocument(response.body);
    const address = response.status === 200 ? hasPostalAddressText(doc.text()) : null;
    imprint = {
      url: imprintUrl,
      status: response.status,
      postal_code: address?.postal_code ?? false,
      street: address?.street ?? false,
    };
    if (response.status === 200 && consider(imprintUrl, doc)) return organizationPass();
    if (imprint.postal_code && imprint.street) {
      return pass(`imprint page ${imprintUrl} carries a postal address`, evidence());
    }
  }

  const contactUrl = target.sampled.policies.contact;
  if (contactUrl) {
    const response = await fetcher.fetch(contactUrl);
    if (response.status === 200 && consider(contactUrl, new HtmlDocument(response.body))) {
      return organizationPass();
    }
  }

  if (best.organization) {
    return warn(
      best.organization.name
        ? `Organization JSON-LD "${best.organization.name}" lacks address and contact details`
        : 'Organization JSON-LD carries no name',
      evidence(),
    );
  }
  if (imprint?.status === 200) {
    return warn(`imprint page ${imprint.url} shows no complete postal address`, evidence());
  }
  return fail('no Organization JSON-LD and no imprint page with a postal address', evidence());
});

/**
 * Link text or path that points at a contact form or help desk, as whole words so that
 * "high-support-sports-bras" or a "Help me choose" product guide do not count.
 */
const CONTACT_LINK =
  /\b(contacts?|contact[- ]us|contactez|kontakt|contatt[io]|contacto|support|help|hilfe|aide|ayuda|customer[- ]service|kundenservice|kundendienst|service client|servizio clienti|faq)\b/i;

/** Words a contact label may consist of besides the contact words themselves. */
const CONTACT_LABEL_WORDS =
  /^(?:us|me|page|form|center|centre|desk|team|&|and|our|your|the|get|in|touch|uns|nous|contactez|service|customer|client|clienti|cliente|hilfe|aide|ayuda|faq|faqs)$/i;
function isContactLabelWord(token: string): boolean {
  return CONTACT_LINK.test(token) || CONTACT_LABEL_WORDS.test(token);
}

export const contactChannel = defineCheck('B4.5', ({ target }) => {
  // A help centre on the store's own subdomain (support.shop.example) is the store's.
  const sameSite = (hostname: string): boolean =>
    registrableDomain(hostname) === registrableDomain(target.hostname);
  const mailto = new Set<string>();
  const tel = new Set<string>();
  const sameOrigin = new Set<string>();
  const crossOrigin = new Set<string>();
  for (const anchor of target.homeDoc.anchors()) {
    const href = anchor.href.trim();
    if (/^mailto:/i.test(href)) {
      const address = href.slice('mailto:'.length).split('?')[0]?.trim();
      if (address) mailto.add(address);
      continue;
    }
    if (/^tel:/i.test(href)) {
      const number = href.slice('tel:'.length).trim();
      if (number) tel.add(number);
      continue;
    }
    let url: URL;
    try {
      url = new URL(href, target.origin);
    } catch {
      continue;
    }
    if (url.protocol !== 'http:' && url.protocol !== 'https:') continue;
    url.hash = '';
    if (url.href === `${target.origin}/`) continue;
    // Product and listing pages are never the contact channel, whatever their slug says,
    // and a support form inside the account area answers with a login wall.
    if (looksLikeProductUrl(url.href) || isListingPath(url.pathname)) continue;
    if (ACCOUNT_AREA_PATTERN.test(url.pathname)) continue;
    // A short label made of contact words ("Contact us", "Help", "Kundenservice"), or a
    // path whose last segment is one; longer labels ("Find your support") are not links
    // to a contact channel.
    const label = anchor.text.trim().split(/\s+/).filter(Boolean);
    const labelMatches =
      CONTACT_LINK.test(anchor.text) && label.length <= 3 && label.every(isContactLabelWord);
    const pathMatches = CONTACT_LINK.test(url.pathname.split('/').filter(Boolean).pop() ?? '');
    if (!labelMatches && !pathMatches) continue;
    (sameSite(url.hostname) ? sameOrigin : crossOrigin).add(url.href);
  }
  // The resolver's ranked pick leads the list, so the message names the best page.
  const resolved = target.sampled.policies.contact;
  if (resolved) {
    const bucket = sameSite(new URL(resolved).hostname) ? sameOrigin : crossOrigin;
    const rest = [...bucket].filter((url) => url !== resolved);
    bucket.clear();
    bucket.add(resolved);
    for (const url of rest) bucket.add(url);
  }
  // A page on the store's own subdomain is named with its host; one on this origin by path.
  const describeContact = (url: string): string => {
    const parsed = new URL(url);
    return parsed.hostname === target.hostname ? pathOf(url) : `${parsed.hostname}${pathOf(url)}`;
  };

  const evidence = {
    mailto: [...mailto],
    tel: [...tel],
    contact_pages: [...sameOrigin],
    cross_origin: [...crossOrigin],
  };
  const first = (set: Set<string>): string => [...set][0] ?? '';
  const channels = [
    ...(mailto.size > 0 ? [`${mailto.size} mailto: address(es)`] : []),
    ...(tel.size > 0 ? [`${tel.size} tel: number(s)`] : []),
    ...(sameOrigin.size > 0
      ? [`${sameOrigin.size} contact page(s) such as ${describeContact(first(sameOrigin))}`]
      : []),
  ];
  if (channels.length > 0) return pass(`the home page links ${channels.join(', ')}`, evidence);
  if (crossOrigin.size > 0) {
    return warn(`only a contact link on another site: ${first(crossOrigin)}`, evidence);
  }
  return fail('no mailto:, tel: or contact page link on the home page', evidence);
});

/** Policy kinds an agent reads for terms; imprint and contact are identity (B4.4, B4.5). */
const READABLE_POLICY_KINDS = ['returns', 'shipping', 'privacy', 'terms'] as const;
const NOINDEX = /\bnoindex\b/i;
/** More words than a stub or an app shell; the policy checks themselves set their own bars. */
const MIN_POLICY_WORDS = 100;

/** The policy check that vouches for each kind; a kind it rejected as a product page is not a policy page here either. */
const POLICY_CHECK_FOR_KIND: Partial<Record<(typeof READABLE_POLICY_KINDS)[number], string>> = {
  returns: 'B4.1',
  shipping: 'B4.2',
};

export const policyPagesAgentReadable = defineCheck(
  'B4.6',
  async ({ target, fetcher, outcomes }) => {
    const found = READABLE_POLICY_KINDS.flatMap((kind) => {
      const url = target.sampled.policies[kind];
      if (!url) return [];
      const vouching = POLICY_CHECK_FOR_KIND[kind];
      if (vouching && outcomes.get(vouching)?.evidence.product_page === true) return [];
      return [{ kind, url }];
    });
    if (found.length === 0) {
      return skip('not_applicable', 'no policy page found on the home page');
    }
    const pages: Record<
      string,
      {
        url: string;
        status: number;
        words: number;
        noindex: boolean;
        blocked_agents: string[];
        readable: boolean;
      }
    > = {};
    const problems: string[] = [];
    const limited: string[] = [];
    let readable = 0;
    for (const { kind, url } of found) {
      const response = await fetcher.fetch(url);
      const doc = new HtmlDocument(response.body);
      const words = doc.wordCount();
      const directives = `${response.headers['x-robots-tag'] ?? ''} ${doc.meta('robots') ?? ''}`;
      const noindex = NOINDEX.test(directives);
      // The target's robots.txt only speaks for its own origin.
      const robots = new URL(url).origin === target.origin ? target.robots : null;
      const path = pathOf(url);
      const blocked = robots
        ? SEARCH_CRAWLERS.map((crawler) => crawler.token).filter(
            (agent) => !isAllowed(robots, agent, path),
          )
        : [];
      const ok = response.status === 200 && words > MIN_POLICY_WORDS && blocked.length === 0;
      pages[kind] = {
        url,
        status: response.status,
        words,
        noindex,
        blocked_agents: blocked,
        readable: ok,
      };
      if (ok) {
        readable += 1;
        // Reachable for every fetcher, but kept out of the indexes that ground AI answers.
        if (noindex) limited.push(`${kind}: noindex`);
      } else if (response.status !== 200) problems.push(`${kind}: ${describeFailure(response)}`);
      else if (words <= MIN_POLICY_WORDS) problems.push(`${kind}: ${words} words`);
      else problems.push(`${kind}: blocks ${blocked.join(', ')}`);
    }
    const total = found.length;
    const notes = [
      ...problems,
      ...limited.map((item) => `${item}, reachable but excluded from indexes`),
    ];
    const message = `${readable} of ${total} policy page(s) are readable by the crawlers behind AI answers${
      notes.length > 0 ? ` (${notes.join('; ')})` : ''
    }`;
    const evidence = { pages, readable, total, problems, limited };
    if (readable === total && limited.length > 0) return warn(message, evidence);
    return outcomeForRatio(readable, total, message, evidence, 0);
  },
);

export const securityTxt = defineCheck('B4.7', async ({ target, fetcher }) => {
  const url = `${target.origin}/.well-known/security.txt`;
  const response = await fetcher.fetch(url);
  const evidence: Record<string, unknown> = {
    url,
    status: response.status,
    content_type: contentType(response),
  };
  // Optional and not an agent-readiness signal: absence is nothing to evaluate.
  if (response.status !== 200 || /<html|<!doctype/i.test(response.body.slice(0, 500))) {
    return skip('not_applicable', 'no security.txt; optional', evidence);
  }
  const parsed = parseSecurityTxt(response.body);
  evidence.contacts = parsed.contacts;
  evidence.expires = parsed.expires?.toISOString() ?? null;
  if (parsed.contacts.length === 0) return warn('security.txt lacks a Contact field', evidence);
  if (!parsed.expires) return warn('security.txt lacks a valid Expires field', evidence);
  if (parsed.expires.getTime() < Date.now()) return warn('security.txt has expired', evidence);
  return pass(
    `security.txt with ${parsed.contacts.length} contact(s), expires ${parsed.expires.toISOString().slice(0, 10)}`,
    evidence,
  );
});
