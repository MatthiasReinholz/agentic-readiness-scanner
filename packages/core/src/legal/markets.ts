/**
 * Which markets a store appears to sell to, from public signals only: the country-code
 * domain, region subtags in the page language and hreflang alternates, the currency of
 * offers, the country in Organization and return-policy markup, and national register
 * numbers on the page. A market needs one signal; every signal is kept as evidence so a
 * report can say why a law was considered. Whoever starts a scan can choose the markets.
 */
import type { Market, MarketDetection } from '@agentic-readiness/catalog';

import type { HtmlDocument } from '../parsers/html.js';
import { asString, extractJsonLd, type JsonLdNode } from '../parsers/jsonld.js';
import { findIdentifiers } from '../parsers/legal.js';

/** EU and EEA country codes whose consumer law follows the EU directives. */
const EU_COUNTRIES = new Set([
  'AT',
  'BE',
  'BG',
  'CY',
  'CZ',
  'DE',
  'DK',
  'EE',
  'ES',
  'FI',
  'FR',
  'GR',
  'EL',
  'HR',
  'HU',
  'IE',
  'IT',
  'LT',
  'LU',
  'LV',
  'MT',
  'NL',
  'PL',
  'PT',
  'RO',
  'SE',
  'SI',
  'SK',
  'IS',
  'LI',
  'NO',
]);

const COUNTRY_MARKET: Readonly<Record<string, Market>> = {
  GB: 'UK',
  UK: 'UK',
  CH: 'CH',
  US: 'US',
  CA: 'CA',
  AU: 'AU',
  BR: 'BR',
  AR: 'AR',
  CL: 'CL',
  CO: 'CO',
  PE: 'PE',
};

export function marketOfCountry(code: string): Market | null {
  const upper = code.trim().toUpperCase();
  if (EU_COUNTRIES.has(upper)) return 'EU';
  return COUNTRY_MARKET[upper] ?? null;
}

const CURRENCY_MARKET: Readonly<Record<string, Market>> = {
  EUR: 'EU',
  GBP: 'UK',
  CHF: 'CH',
  USD: 'US',
  CAD: 'CA',
  AUD: 'AU',
  BRL: 'BR',
  ARS: 'AR',
  CLP: 'CL',
  COP: 'CO',
  PEN: 'PE',
  SEK: 'EU',
  DKK: 'EU',
  PLN: 'EU',
  CZK: 'EU',
  HUF: 'EU',
  RON: 'EU',
  BGN: 'EU',
};

/** The market of a hostname's country-code top-level domain (.de, .co.uk, .com.br). */
export function marketOfHostname(hostname: string): { market: Market; tld: string } | null {
  const labels = hostname.toLowerCase().split('.');
  const tld = labels[labels.length - 1] ?? '';
  // .co is sold as a generic domain; only .com.co and the like say Colombia.
  if (tld === 'co' && labels[labels.length - 2] !== 'com') return null;
  if (tld === 'eu') return { market: 'EU', tld: '.eu' };
  if (tld.length !== 2) return null;
  const market = marketOfCountry(tld === 'uk' ? 'GB' : tld);
  return market ? { market, tld: `.${tld}` } : null;
}

function regionOf(tag: string): string | null {
  const parts = tag.trim().split(/[-_]/);
  const region = parts.find((part, index) => index > 0 && /^[A-Za-z]{2}$/.test(part));
  return region ? region.toUpperCase() : null;
}

function collect(nodes: readonly JsonLdNode[], key: string, out: string[]): void {
  const visit = (value: unknown): void => {
    if (Array.isArray(value)) {
      for (const item of value) visit(item);
      return;
    }
    if (!value || typeof value !== 'object') return;
    const node = value as Record<string, unknown>;
    for (const [name, child] of Object.entries(node)) {
      if (name === key) {
        const text = asString(child);
        if (text) out.push(text);
        else if (child && typeof child === 'object') {
          const nested = asString((child as Record<string, unknown>).name);
          if (nested) out.push(nested);
          else visit(child);
        }
      } else if (child && typeof child === 'object') visit(child);
    }
  };
  visit(nodes);
}

/** Signals per market found in one page. */
export function marketSignals(
  doc: HtmlDocument,
  text: string = doc.text(),
): Map<Market, Set<string>> {
  const signals = new Map<Market, Set<string>>();
  const add = (market: Market | null, evidence: string) => {
    if (!market) return;
    const set = signals.get(market) ?? new Set<string>();
    set.add(evidence);
    signals.set(market, set);
  };
  const lang = doc.lang();
  if (lang) {
    const region = regionOf(lang);
    if (region) add(marketOfCountry(region), `page language ${lang}`);
  }
  for (const link of doc.links()) {
    if (!link.hreflang || link.rel.toLowerCase() !== 'alternate') continue;
    const region = regionOf(link.hreflang);
    if (region) add(marketOfCountry(region), `hreflang ${link.hreflang}`);
  }
  const nodes = extractJsonLd(doc).nodes;
  const currencies: string[] = [];
  collect(nodes, 'priceCurrency', currencies);
  for (const currency of new Set(currencies.map((value) => value.toUpperCase()))) {
    add(CURRENCY_MARKET[currency] ?? null, `prices in ${currency}`);
  }
  const countries: string[] = [];
  collect(nodes, 'addressCountry', countries);
  collect(nodes, 'applicableCountry', countries);
  for (const country of new Set(countries.map((value) => value.trim()))) {
    if (/^[A-Za-z]{2}$/.test(country))
      add(marketOfCountry(country), `country ${country.toUpperCase()} in markup`);
  }
  const SCHEME_MARKET: Record<string, Market> = {
    'eu-vat': 'EU',
    'uk-company': 'UK',
    'ch-uid': 'CH',
    'br-cnpj': 'BR',
    'cl-rut': 'CL',
    'co-nit': 'CO',
    'ar-cuit': 'AR',
    'pe-ruc': 'PE',
  };
  for (const identifier of findIdentifiers(text)) {
    if (identifier.valid)
      add(SCHEME_MARKET[identifier.scheme] ?? null, `${identifier.scheme} ${identifier.value}`);
  }
  return signals;
}

/**
 * Markets from the hostname and the pages read (home page first, then product pages),
 * ordered by how many signals each has. Only markets the legal catalog knows are kept.
 */
export function detectMarkets(hostname: string, docs: readonly HtmlDocument[]): MarketDetection[] {
  const merged = new Map<Market, Set<string>>();
  const host = marketOfHostname(hostname);
  if (host) merged.set(host.market, new Set([`${host.tld} domain`]));
  for (const doc of docs) {
    for (const [market, evidence] of marketSignals(doc)) {
      const set = merged.get(market) ?? new Set<string>();
      for (const item of evidence) set.add(item);
      merged.set(market, set);
    }
  }
  return [...merged.entries()]
    .map(([market, evidence]) => ({ market, evidence: [...evidence].slice(0, 6) }))
    .sort((a, b) => b.evidence.length - a.evidence.length || a.market.localeCompare(b.market));
}

/** Market codes a person may pass to choose markets: case-insensitive, GB for UK accepted. */
export function parseMarkets(input: string | readonly string[]): Market[] {
  const tokens = (typeof input === 'string' ? input.split(/[\s,]+/) : input)
    .map((token) => token.trim().toUpperCase())
    .filter(Boolean);
  const markets = new Set<Market>();
  const known = new Set<string>(['EU', 'UK', 'CH', 'US', 'CA', 'AU', 'BR', 'AR', 'CL', 'CO', 'PE']);
  for (const token of tokens) {
    const code = token === 'GB' ? 'UK' : (token.split('-')[0] ?? token);
    if (known.has(code)) markets.add(code as Market);
    else {
      const market = marketOfCountry(code);
      if (market) markets.add(market);
      else
        throw new Error(
          `Unknown market "${token}". Use EU, UK, CH, US, CA, AU, BR, AR, CL, CO or PE.`,
        );
    }
  }
  return [...markets];
}
