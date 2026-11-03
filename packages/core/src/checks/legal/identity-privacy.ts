/**
 * C1 seller identity and complaints, C2 privacy notices and choices. Each check reports
 * what it found on the pages read; none of them says a store complies.
 */
import type { Market } from '@agentic-readiness/catalog';

import {
  asString,
  extractJsonLd,
  organizationNodes,
  type JsonLdNode,
} from '../../parsers/jsonld.js';
import {
  ADVERTISING_COOKIES,
  ANALYTICS_COOKIES,
  CCPA_OPT_OUT_LABEL,
  CONSENT_BLOCKED,
  CONSENT_MODE_DENIED,
  EMAIL_PATTERN,
  findIdentifiers,
  LEGAL_FORM_PATTERN,
  ODR_LINK,
  ODR_WORDING,
  POSTAL_ADDRESS_PATTERN,
  PRIVACY_LABEL,
  PRIVACY_ROLE,
  TRACKERS,
  vendorsIn,
  type FoundIdentifier,
} from '../../parsers/legal.js';
import { attribute } from '../../parsers/html.js';
import { fail, pass, skip, warn } from '../types.js';
import {
  actionLabels,
  defineLegalCheck,
  legalPage,
  legalPages,
  pathname,
  unreadable,
} from './shared.js';

function organizationFacts(nodes: readonly JsonLdNode[]): {
  name?: string;
  address: boolean;
  email: boolean;
} {
  const facts: { name?: string; address: boolean; email: boolean } = {
    address: false,
    email: false,
  };
  for (const node of organizationNodes([...nodes])) {
    const name = asString(node.legalName) ?? asString(node.name);
    if (name && !facts.name) facts.name = name;
    const address = node.address;
    if (address && typeof address === 'object' && asString((address as JsonLdNode).streetAddress)) {
      facts.address = true;
    }
    if (asString(node.email)) facts.email = true;
    const contact = node.contactPoint;
    const points = Array.isArray(contact) ? contact : contact ? [contact] : [];
    if (
      points.some(
        (point) => point && typeof point === 'object' && asString((point as JsonLdNode).email),
      )
    ) {
      facts.email = true;
    }
  }
  return facts;
}

export const sellerIdentity = defineLegalCheck('C1.1', async ({ target, fetcher }) => {
  const pages = await legalPages(target, fetcher, ['imprint', 'contact', 'home']);
  const readable = pages.filter((page) => page.readable);
  const text = readable.map((page) => page.text).join('\n');
  const mailto = readable.some((page) =>
    page.doc.anchors().some((anchor) => /^mailto:/i.test(anchor.href)),
  );
  const markup = organizationFacts(readable.flatMap((page) => extractJsonLd(page.doc).nodes));
  const legalName = LEGAL_FORM_PATTERN.exec(text)?.[0];
  const found = {
    legal_name: Boolean(legalName ?? markup.name),
    postal_address: markup.address || POSTAL_ADDRESS_PATTERN.test(text),
    email: markup.email || mailto || EMAIL_PATTERN.test(text),
  };
  const evidence = {
    pages: pages.map((page) => ({ kind: page.kind, url: page.url, status: page.response.status })),
    found,
    ...(markup.name ? { organization: markup.name } : {}),
    ...(legalName ? { legal_form: legalName } : {}),
  };
  const present = Object.entries(found)
    .filter(([, value]) => value)
    .map(([key]) => key.replace('_', ' '));
  const missing = Object.entries(found)
    .filter(([, value]) => !value)
    .map(([key]) => key.replace('_', ' '));
  const where = pages.some((page) => page.kind === 'imprint' || page.kind === 'contact')
    ? 'the identity and contact pages'
    : 'the home page (no imprint or contact page was linked)';
  if (missing.length === 0)
    return pass(`legal name, postal address and email address found on ${where}`, evidence);
  if (present.length === 0)
    return fail(`no legal name, postal address or email address found on ${where}`, evidence);
  return warn(
    `found ${present.join(' and ')} but no ${missing.join(' or ')} on ${where}`,
    evidence,
  );
});

/** Which identifier each market asks for, and how to say it. */
const MARKET_IDENTIFIER: Partial<
  Record<Market, { scheme: FoundIdentifier['scheme']; label: string }>
> = {
  EU: { scheme: 'eu-vat', label: 'EU VAT ID' },
  UK: { scheme: 'uk-company', label: 'UK company number' },
  CH: { scheme: 'ch-uid', label: 'Swiss UID' },
  BR: { scheme: 'br-cnpj', label: 'Brazilian CNPJ' },
  CL: { scheme: 'cl-rut', label: 'Chilean RUT' },
  CO: { scheme: 'co-nit', label: 'Colombian NIT' },
  AR: { scheme: 'ar-cuit', label: 'Argentine CUIT' },
  PE: { scheme: 'pe-ruc', label: 'Peruvian RUC' },
};

export const registrationNumbers = defineLegalCheck(
  'C1.2',
  async ({ target, fetcher }, markets) => {
    const pages = await legalPages(target, fetcher, ['imprint', 'contact', 'terms', 'home']);
    const text = pages
      .filter((page) => page.readable)
      .map((page) => page.text)
      .join('\n');
    const identifiers = findIdentifiers(text);
    const perMarket = markets.flatMap((market) => {
      const wanted = MARKET_IDENTIFIER[market];
      if (!wanted) return [];
      const matches = identifiers.filter((item) => item.scheme === wanted.scheme);
      const state = matches.some((item) => item.valid)
        ? 'valid'
        : matches.length > 0
          ? 'invalid'
          : 'missing';
      return [{ market, label: wanted.label, state, values: matches.map((item) => item.value) }];
    });
    const evidence = { markets: perMarket, identifiers, pages: pages.map((page) => page.url) };
    const valid = perMarket.filter((item) => item.state === 'valid');
    const invalid = perMarket.filter((item) => item.state === 'invalid');
    const missing = perMarket.filter((item) => item.state === 'missing');
    const describe = (items: typeof perMarket) => items.map((item) => item.label).join(', ');
    if (perMarket.length > 0 && valid.length === perMarket.length) {
      return pass(`found ${describe(valid)}`, evidence);
    }
    if (valid.length === 0 && invalid.length === 0) {
      return fail(
        `no ${describe(missing)} found on the identity, contact, terms or home page`,
        evidence,
      );
    }
    const parts = [
      valid.length > 0 ? `found ${describe(valid)}` : '',
      invalid.length > 0 ? `check digit fails for ${describe(invalid)}` : '',
      missing.length > 0 ? `no ${describe(missing)}` : '',
    ].filter(Boolean);
    return warn(parts.join('. '), evidence);
  },
);

export const libroDeReclamaciones = defineLegalCheck('C1.3', ({ target }) => {
  const label = actionLabels(target.homeDoc).find((item) =>
    /libro de reclamaciones/i.test(item.text),
  );
  if (label)
    return pass('the home page links the Libro de Reclamaciones', {
      label: label.text,
      href: label.href ?? null,
    });
  return fail('no link to a Libro de Reclamaciones on the home page');
});

export const noOutdatedOdrLink = defineLegalCheck('C1.4', async ({ target, fetcher }) => {
  const pages = (await legalPages(target, fetcher, ['home', 'terms', 'imprint'])).filter(
    (page) => page.readable,
  );
  const hits = pages.flatMap((page) => {
    const links = page.doc
      .anchors()
      .filter((anchor) => ODR_LINK.test(anchor.href))
      .map((anchor) => anchor.href);
    const wording = ODR_WORDING.exec(page.text)?.[0];
    return links.length > 0 || wording
      ? [{ url: page.url, links, ...(wording ? { wording } : {}) }]
      : [];
  });
  if (hits.length > 0) {
    return warn(
      `still points to the EU ODR platform, which closed on 20 July 2025: ${hits.map((hit) => hit.url).join(', ')}`,
      { pages: hits },
    );
  }
  return pass('no link to the closed EU ODR platform on the home, terms or imprint page', {
    pages: pages.map((page) => page.url),
  });
});

/** The privacy notice: the page the resolver found, or a home-page link labelled as one. */
async function privacyNotice(
  target: Parameters<typeof legalPage>[0],
  fetcher: Parameters<typeof legalPage>[1],
) {
  const found = await legalPage(target, fetcher, 'privacy');
  if (found) return found;
  const link = target.homeDoc
    .anchors()
    .find(
      (anchor) =>
        PRIVACY_LABEL.test(anchor.text) || PRIVACY_LABEL.test(pathname(anchor.href, target.origin)),
    );
  if (!link) return null;
  let url: string;
  try {
    url = new URL(link.href, target.home.finalUrl).href;
  } catch {
    return null;
  }
  return legalPage(
    {
      ...target,
      sampled: { ...target.sampled, policies: { ...target.sampled.policies, privacy: url } },
    },
    fetcher,
    'privacy',
  );
}

export const privacyNoticeLinked = defineLegalCheck('C2.1', async ({ target, fetcher }) => {
  const page = await privacyNotice(target, fetcher);
  if (!page) return fail('no privacy notice is linked from the home page');
  if (!page.readable)
    return warn(`the privacy notice could not be read: ${unreadable(page)}`, { url: page.url });
  const names =
    LEGAL_FORM_PATTERN.test(page.text) ||
    organizationFacts(extractJsonLd(page.doc).nodes).name !== undefined;
  const contact = EMAIL_PATTERN.test(page.text) || POSTAL_ADDRESS_PATTERN.test(page.text);
  const evidence = { url: page.url, names_controller: names, contact };
  if (contact) return pass(`privacy notice at ${page.url} names a contact`, evidence);
  return warn(
    `privacy notice at ${page.url} gives no email or postal address for the controller`,
    evidence,
  );
});

export const privacyContact = defineLegalCheck('C2.2', async ({ target, fetcher }) => {
  const page = await privacyNotice(target, fetcher);
  if (!page?.readable) return skip('not_applicable', 'no readable privacy notice to read');
  const role = PRIVACY_ROLE.exec(page.text);
  const near = role ? EMAIL_PATTERN.exec(page.text.slice(role.index, role.index + 600)) : null;
  const evidence = { url: page.url, role: role?.[0] ?? null, email: near?.[0] ?? null };
  if (role && near)
    return pass(`the privacy notice names a ${role[0]} with an email address`, evidence);
  if (role)
    return warn(
      `the privacy notice names a ${role[0]} but gives no email address near it`,
      evidence,
    );
  if (EMAIL_PATTERN.test(page.text)) {
    return warn(
      'the privacy notice gives an email address but names no data protection or privacy officer',
      evidence,
    );
  }
  return fail('the privacy notice names no privacy contact', evidence);
});

export const californiaOptOutLinks = defineLegalCheck('C2.3', ({ target }) => {
  const labels = actionLabels(target.homeDoc).filter((item) => CCPA_OPT_OUT_LABEL.test(item.text));
  if (labels.length > 0) {
    return pass(`the home page links "${labels[0]?.text ?? ''}"`, {
      labels: labels.map((item) => item.text).slice(0, 4),
    });
  }
  return warn(
    'no "Do Not Sell or Share" or "Your Privacy Choices" link on the home page. It is needed only by businesses that meet the CCPA thresholds and sell or share personal information',
  );
});

export const globalPrivacyControl = defineLegalCheck('C2.4', async ({ target, fetcher }) => {
  const url = `${target.origin}/.well-known/gpc.json`;
  const response = await fetcher.fetch(url);
  let declared: boolean | null = null;
  if (response.status === 200) {
    try {
      const parsed = JSON.parse(response.body) as unknown;
      if (parsed && typeof parsed === 'object' && 'gpc' in parsed) declared = parsed.gpc === true;
    } catch {
      declared = null;
    }
  }
  const privacy = await privacyNotice(target, fetcher);
  const mentioned = privacy?.readable
    ? (/global privacy control|opt-out preference signal|\bGPC\b|Sec-GPC/i.exec(
        privacy.text,
      )?.[0] ?? null)
    : null;
  const evidence = {
    gpc_json: { url, status: response.status, gpc: declared },
    privacy_mentions: mentioned,
  };
  if (declared === true) return pass('/.well-known/gpc.json declares "gpc": true', evidence);
  if (mentioned) return pass(`the privacy notice mentions "${mentioned}"`, evidence);
  if (declared === false) return warn('/.well-known/gpc.json declares "gpc": false', evidence);
  return warn(
    'no gpc.json and no mention of Global Privacy Control in the privacy notice. Whether the site honours GPC cannot be checked without JavaScript',
    evidence,
  );
});

function cookieNames(header: string | undefined): string[] {
  if (!header) return [];
  return header
    .split(/,(?=\s*[^;,=\s]+=)/)
    .map((cookie) => cookie.split('=')[0]?.trim() ?? '')
    .filter(Boolean);
}

export const noTrackingBeforeConsent = defineLegalCheck('C2.5', ({ target }) => {
  const names = cookieNames(target.home.headers['set-cookie']);
  const advertising = names.filter((name) => ADVERTISING_COOKIES.test(name));
  const analytics = names.filter((name) => ANALYTICS_COOKIES.test(name));
  const unblocked: string[] = [];
  const consentModeDenied = target.homeDoc
    .inlineScripts()
    .some((script) => CONSENT_MODE_DENIED.test(script));
  for (const element of target.homeDoc.elements('script')) {
    const src = attribute(element, 'src') ?? '';
    const inline = src
      ? ''
      : element.children.map((child) => ('data' in child ? child.data : '')).join('');
    const named = vendorsIn(src ? [src] : [], inline ? [inline] : [], TRACKERS);
    const tracker = TRACKERS.find((item) => named.includes(item.name));
    if (!tracker) continue;
    const attributes = Object.entries(element.attribs)
      .map(([key, value]) => `${key}="${value}"`)
      .join(' ');
    if (CONSENT_BLOCKED.test(attributes)) continue;
    if (consentModeDenied && /google/i.test(tracker.name)) continue;
    if (!unblocked.includes(tracker.name)) unblocked.push(tracker.name);
  }
  const evidence = {
    set_cookie: names,
    advertising_cookies: advertising,
    analytics_cookies: analytics,
    unblocked_trackers: unblocked,
  };
  if (advertising.length > 0) {
    return warn(
      `the first response sets advertising cookie(s) before any consent could be given: ${advertising.join(', ')}`,
      evidence,
    );
  }
  if (analytics.length > 0 || unblocked.length > 0) {
    const parts = [
      analytics.length > 0 ? `sets analytics cookie(s) ${analytics.join(', ')}` : '',
      unblocked.length > 0
        ? `loads ${unblocked.join(', ')} without a consent block in the static HTML`
        : '',
    ].filter(Boolean);
    return warn(`the home page ${parts.join(' and ')}. Check that they wait for consent`, evidence);
  }
  return pass(
    'no advertising or analytics cookie on the first response and no unblocked tracker tag in the static HTML (trackers loaded by JavaScript are not seen)',
    evidence,
  );
});
