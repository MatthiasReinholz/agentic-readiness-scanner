import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { resolveTarget } from '../../target/resolver.js';
import { fixtureFetcher, mapFetcher, runCheck, targetFor } from '../../testing/index.js';
import {
  contactChannel,
  merchantIdentity,
  policyPagesAgentReadable,
  privacyAndTermsFound,
  returnPolicyFound,
  securityTxt,
  shippingPolicyFound,
} from './index.js';

function pageOf(words: number, extra = ''): string {
  const text = Array.from({ length: words }, (_, i) => `word${i}`).join(' ');
  return `<!doctype html><html><head><title>Policy</title></head><body><main><p>${text}</p>${extra}</main></body></html>`;
}

const returns = 'https://shop.example/returns/';
const shipping = 'https://shop.example/shipping/';

describe('B4.1 return policy', () => {
  it('fails without a link, fails on a 404 page, warns on a short page, passes on a real one', async () => {
    const missing = await runCheck(returnPolicyFound, targetFor(), mapFetcher({}));
    expect(missing.verdict).toBe('fail');
    expect(missing.message).toMatch(/no return or refund policy link/);
    const gone = await runCheck(
      returnPolicyFound,
      targetFor({ policies: { returns } }),
      mapFetcher({}),
    );
    expect(gone.verdict).toBe('fail');
    expect(gone.message).toBe('return policy page returned HTTP 404');
    expect(gone.evidence).toMatchObject({ url: returns, status: 404 });
    const short = await runCheck(
      returnPolicyFound,
      targetFor({ policies: { returns } }),
      mapFetcher({ [returns]: pageOf(40) }),
    );
    expect(short.verdict).toBe('warn');
    // 40 body words plus the title.
    expect(short.evidence).toMatchObject({ status: 200, words: 41 });
    const full = await runCheck(
      returnPolicyFound,
      targetFor({ policies: { returns } }),
      mapFetcher({ [returns]: pageOf(320) }),
    );
    expect(full.verdict).toBe('pass');
  });
});

describe('B4.1 and B4.2 reject product pages', () => {
  it('fails clearly when the linked page is a product, not a policy', async () => {
    const product = `<!doctype html><html><head><title>WooCommerce Shipping</title><script type="application/ld+json">{"@context":"https://schema.org","@type":"Product","name":"WooCommerce Shipping","offers":{"@type":"Offer","price":"0","priceCurrency":"USD"}}</script></head><body><main><p>Print USPS labels with free shipping discounts and 2-3 days delivery.</p><button class="single_add_to_cart_button">Add to cart</button></main></body></html>`;
    const outcome = await runCheck(
      shippingPolicyFound,
      targetFor({ policies: { shipping } }),
      mapFetcher({ [shipping]: product }),
    );
    expect(outcome.verdict).toBe('fail');
    expect(outcome.message).toBe(
      `the only link that mentions shipping leads to a product page (${shipping}), not to a shipping policy`,
    );
    expect(outcome.evidence).toMatchObject({ product_page: true });
    const returnsOutcome = await runCheck(
      returnPolicyFound,
      targetFor({ policies: { returns } }),
      mapFetcher({ [returns]: product }),
    );
    expect(returnsOutcome.verdict).toBe('fail');
    expect(returnsOutcome.message).toMatch(/leads to a product page/);
  });
});

describe('B4.2 shipping policy', () => {
  it('warns when the page states no costs, regions or times and passes when it does', async () => {
    const vague = await runCheck(
      shippingPolicyFound,
      targetFor({ policies: { shipping } }),
      mapFetcher({ [shipping]: pageOf(50) }),
    );
    expect(vague.verdict).toBe('warn');
    expect(vague.evidence).toMatchObject({ mentions_costs_regions_or_times: false });
    const concrete = await runCheck(
      shippingPolicyFound,
      targetFor({ policies: { shipping } }),
      mapFetcher({ [shipping]: pageOf(50, '<p>Delivery in 2-4 business days, 4,90 €.</p>') }),
    );
    expect(concrete.verdict).toBe('pass');
  });
});

describe('B4.3 privacy policy and terms', () => {
  const privacy = 'https://shop.example/privacy/';
  const terms = 'https://shop.example/terms/';

  it('counts the pages that answer 200', async () => {
    const both = await runCheck(
      privacyAndTermsFound,
      targetFor({ policies: { privacy, terms } }),
      mapFetcher({ [privacy]: pageOf(10), [terms]: pageOf(10) }),
    );
    expect(both.verdict).toBe('pass');
    expect(both.evidence).toMatchObject({ privacy_status: 200, terms_status: 200 });
    const one = await runCheck(
      privacyAndTermsFound,
      targetFor({ policies: { privacy, terms } }),
      mapFetcher({ [privacy]: pageOf(10) }),
    );
    expect(one.verdict).toBe('warn');
    expect(one.evidence).toMatchObject({ terms_status: 404 });
    const none = await runCheck(privacyAndTermsFound, targetFor(), mapFetcher({}));
    expect(none.verdict).toBe('fail');
    expect(none.evidence).toEqual({ privacy: null, terms: null });
  });
});

function jsonLdPage(node: Record<string, unknown>, body = '<main>Shop</main>'): string {
  return `<!doctype html><html><head><title>Shop</title><script type="application/ld+json">${JSON.stringify(
    { '@context': 'https://schema.org', ...node },
  )}</script></head><body>${body}</body></html>`;
}

function textPage(text: string): string {
  return `<!doctype html><html><head><title>Imprint</title></head><body><main><p>${text}</p></main></body></html>`;
}

const home = 'https://shop.example/';
const imprint = 'https://shop.example/imprint/';
const contact = 'https://shop.example/contact/';
const organization = {
  '@type': 'Organization',
  name: 'Example Ceramics GmbH',
  address: { '@type': 'PostalAddress', streetAddress: 'Töpferstraße 12', postalCode: '10115' },
  contactPoint: { '@type': 'ContactPoint', email: 'hello@shop.example' },
};

describe('B4.4 merchant identity', () => {
  it('passes on home page Organization JSON-LD with a name and address or contact', async () => {
    const outcome = await runCheck(
      merchantIdentity,
      targetFor({ homeHtml: jsonLdPage(organization), policies: { imprint } }),
      mapFetcher({}),
    );
    expect(outcome.verdict).toBe('pass');
    expect(outcome.message).toBe(
      `Organization JSON-LD "Example Ceramics GmbH" with address, contactPoint on ${home}`,
    );
    expect(outcome.evidence).toEqual({
      organization: 'Example Ceramics GmbH',
      fields: ['name', 'address', 'contactPoint'],
      source: home,
      sources: [home],
      imprint: null,
    });
  });

  it('passes on an Organization subtype found on the imprint or contact page', async () => {
    const store = { '@type': 'OnlineStore', name: 'Example Ceramics', telephone: '+49 30 1' };
    const fromImprint = await runCheck(
      merchantIdentity,
      targetFor({ policies: { imprint, contact } }),
      mapFetcher({ [imprint]: jsonLdPage(store) }),
    );
    expect(fromImprint.verdict).toBe('pass');
    expect(fromImprint.evidence).toMatchObject({
      organization: 'Example Ceramics',
      fields: ['name', 'telephone'],
      source: imprint,
      sources: [home, imprint],
      imprint: { url: imprint, status: 200 },
    });
    const fromContact = await runCheck(
      merchantIdentity,
      targetFor({ policies: { contact } }),
      mapFetcher({ [contact]: jsonLdPage({ '@graph': [{ ...store, '@type': 'ClothingStore' }] }) }),
    );
    expect(fromContact.verdict).toBe('pass');
    expect(fromContact.evidence).toMatchObject({ source: contact, sources: [home, contact] });
  });

  it('passes on an imprint page whose text carries a postal address', async () => {
    const outcome = await runCheck(
      merchantIdentity,
      targetFor({ policies: { imprint } }),
      mapFetcher({ [imprint]: textPage('Example Ceramics GmbH, Töpferstraße 12, 10115 Berlin') }),
    );
    expect(outcome.verdict).toBe('pass');
    expect(outcome.message).toBe(`imprint page ${imprint} carries a postal address`);
    expect(outcome.evidence).toMatchObject({
      organization: null,
      source: null,
      imprint: { url: imprint, status: 200, postal_code: true, street: true },
    });
  });

  it('warns when Organization JSON-LD lacks address and contact details or a name', async () => {
    const nameOnly = await runCheck(
      merchantIdentity,
      targetFor({ homeHtml: jsonLdPage({ '@type': 'Organization', name: 'Example Ceramics' }) }),
      mapFetcher({}),
    );
    expect(nameOnly.verdict).toBe('warn');
    expect(nameOnly.message).toBe(
      'Organization JSON-LD "Example Ceramics" lacks address and contact details',
    );
    expect(nameOnly.evidence).toMatchObject({ organization: 'Example Ceramics', fields: ['name'] });
    const nameless = await runCheck(
      merchantIdentity,
      targetFor({ homeHtml: jsonLdPage({ '@type': 'Organization', email: 'x@shop.example' }) }),
      mapFetcher({}),
    );
    expect(nameless.verdict).toBe('warn');
    expect(nameless.message).toBe('Organization JSON-LD carries no name');
    expect(nameless.evidence).toMatchObject({ organization: null, fields: ['email'] });
  });

  it('warns when the imprint page is fetchable but shows no complete postal address', async () => {
    const outcome = await runCheck(
      merchantIdentity,
      targetFor({ policies: { imprint } }),
      mapFetcher({ [imprint]: textPage('Founded in Berlin. Write to us any time.') }),
    );
    expect(outcome.verdict).toBe('warn');
    expect(outcome.message).toBe(`imprint page ${imprint} shows no complete postal address`);
    expect(outcome.evidence).toMatchObject({
      imprint: { status: 200, postal_code: false, street: false },
    });
  });

  it('fails when neither Organization JSON-LD nor an imprint address was found', async () => {
    const outcome = await runCheck(
      merchantIdentity,
      targetFor({ policies: { imprint } }),
      mapFetcher({}),
    );
    expect(outcome.verdict).toBe('fail');
    expect(outcome.message).toBe(
      'no Organization JSON-LD and no imprint page with a postal address',
    );
    expect(outcome.evidence).toEqual({
      organization: null,
      fields: [],
      source: null,
      sources: [home],
      imprint: { url: imprint, status: 404, postal_code: false, street: false },
    });
  });
});

function homeWith(links: string): string {
  return `<!doctype html><html><head><title>Shop</title></head><body><main>Shop</main><footer>${links}</footer></body></html>`;
}

describe('B4.5 contact channel', () => {
  it('passes on a mailto: address', async () => {
    const outcome = await runCheck(
      contactChannel,
      targetFor({
        homeHtml: homeWith('<a href="mailto:hello@shop.example?subject=Order">Write to us</a>'),
      }),
      mapFetcher({}),
    );
    expect(outcome.verdict).toBe('pass');
    expect(outcome.message).toBe('the home page links 1 mailto: address(es)');
    expect(outcome.evidence).toEqual({
      mailto: ['hello@shop.example'],
      tel: [],
      contact_pages: [],
      cross_origin: [],
    });
  });

  it('passes on a tel: number', async () => {
    const outcome = await runCheck(
      contactChannel,
      targetFor({ homeHtml: homeWith('<a href="tel:+49301234567">Call</a>') }),
      mapFetcher({}),
    );
    expect(outcome.verdict).toBe('pass');
    expect(outcome.evidence).toMatchObject({ tel: ['+49301234567'] });
  });

  it('passes on a same-origin page whose link text or path says contact', async () => {
    const outcome = await runCheck(
      contactChannel,
      targetFor({
        homeHtml: homeWith(
          '<a href="/about-us/">Kontakt</a><a href="/support/">Here</a><a href="/">Home</a><a href="#contact">Jump</a>',
        ),
      }),
      mapFetcher({}),
    );
    expect(outcome.verdict).toBe('pass');
    expect(outcome.message).toMatch(/^the home page links 2 contact page\(s\) such as \//);
    expect(outcome.evidence).toMatchObject({
      contact_pages: ['https://shop.example/about-us/', 'https://shop.example/support/'],
    });
  });

  it('passes on the contact page the resolver already found', async () => {
    const outcome = await runCheck(
      contactChannel,
      targetFor({ policies: { contact } }),
      mapFetcher({}),
    );
    expect(outcome.verdict).toBe('pass');
    expect(outcome.evidence).toMatchObject({ contact_pages: [contact] });
  });

  it('warns when the only contact link leads to another origin', async () => {
    const outcome = await runCheck(
      contactChannel,
      targetFor({
        homeHtml: homeWith('<a href="https://help.other.example/tickets">Contact support</a>'),
      }),
      mapFetcher({}),
    );
    expect(outcome.verdict).toBe('warn');
    expect(outcome.message).toBe(
      'only a contact link on another site: https://help.other.example/tickets',
    );
    expect(outcome.evidence).toMatchObject({
      contact_pages: [],
      cross_origin: ['https://help.other.example/tickets'],
    });
  });

  it('fails without any contact channel', async () => {
    const outcome = await runCheck(
      contactChannel,
      targetFor({ homeHtml: homeWith('<a href="/shop/">Shop</a>') }),
      mapFetcher({}),
    );
    expect(outcome.verdict).toBe('fail');
    expect(outcome.message).toBe('no mailto:, tel: or contact page link on the home page');
  });
});

describe('B4.6 policy pages are agent-readable', () => {
  const privacy = 'https://shop.example/privacy/';
  const terms = 'https://shop.example/terms/';
  const all = { returns, shipping, privacy, terms };

  it('does not apply when no policy page was found (imprint and contact do not count)', async () => {
    const outcome = await runCheck(
      policyPagesAgentReadable,
      targetFor({ policies: { imprint, contact } }),
      mapFetcher({}),
    );
    expect(outcome.verdict).toBe('skip');
    expect(outcome.skipReason).toBe('not_applicable');
  });

  it('passes when every policy page is served, long enough, indexable and allowed', async () => {
    const outcome = await runCheck(
      policyPagesAgentReadable,
      targetFor({
        policies: { ...all, privacy: 'https://legal.other.example/privacy/' },
        robots: 'User-agent: *\nDisallow: /cart/\n',
      }),
      mapFetcher({
        [returns]: pageOf(150),
        [shipping]: pageOf(150),
        'https://legal.other.example/privacy/': pageOf(150),
        [terms]: pageOf(150),
      }),
    );
    expect(outcome.verdict).toBe('pass');
    expect(outcome.message).toBe(
      '4 of 4 policy page(s) are readable by the crawlers behind AI answers',
    );
    expect(outcome.evidence).toMatchObject({
      readable: 4,
      total: 4,
      problems: [],
      // 150 body words plus the title.
      pages: {
        returns: { url: returns, status: 200, words: 151, noindex: false, blocked_agents: [] },
        privacy: { readable: true },
      },
    });
  });

  it('warns when some policy pages are missing, thin or marked noindex', async () => {
    const outcome = await runCheck(
      policyPagesAgentReadable,
      targetFor({ policies: all }),
      mapFetcher({
        [shipping]: pageOf(50),
        [privacy]: pageOf(150, '<meta name="robots" content="noindex, follow">'),
        [terms]: { status: 200, headers: { 'X-Robots-Tag': 'noai' }, body: pageOf(150) },
      }),
    );
    expect(outcome.verdict).toBe('warn');
    expect(outcome.message).toBe(
      '2 of 4 policy page(s) are readable by the crawlers behind AI answers (returns: HTTP 404; shipping: 51 words; privacy: noindex, reachable but excluded from indexes)',
    );
    expect(outcome.evidence).toMatchObject({
      readable: 2,
      pages: {
        returns: { status: 404, readable: false },
        shipping: { words: 51, readable: false },
        privacy: { noindex: true, readable: true },
        terms: { noindex: false, readable: true },
      },
    });
  });

  it('fails when every policy page is blocked for the crawlers behind answers, warns on noindex by header', async () => {
    const blocked = await runCheck(
      policyPagesAgentReadable,
      targetFor({
        policies: { returns },
        robots: 'User-agent: *\nAllow: /\n\nUser-agent: Claude-SearchBot\nDisallow: /returns/\n',
      }),
      mapFetcher({ [returns]: pageOf(150) }),
    );
    expect(blocked.verdict).toBe('fail');
    expect(blocked.message).toBe(
      '0 of 1 policy page(s) are readable by the crawlers behind AI answers (returns: blocks Claude-SearchBot)',
    );
    expect(blocked.evidence).toMatchObject({
      pages: { returns: { blocked_agents: ['Claude-SearchBot'], readable: false } },
    });
    const header = await runCheck(
      policyPagesAgentReadable,
      targetFor({ policies: { returns } }),
      mapFetcher({
        [returns]: { status: 200, headers: { 'X-Robots-Tag': 'noindex' }, body: pageOf(150) },
      }),
    );
    // noindex keeps the page out of the indexes behind answers, but every fetcher can read it.
    expect(header.verdict).toBe('warn');
    expect(header.message).toMatch(/noindex, reachable but excluded from indexes/);
    expect(header.evidence).toMatchObject({
      pages: { returns: { noindex: true, readable: true } },
      limited: ['returns: noindex'],
    });
  });
});

describe('B4.7 security.txt', () => {
  const url = 'https://shop.example/.well-known/security.txt';
  const run = (body?: string) =>
    runCheck(securityTxt, targetFor(), mapFetcher(body === undefined ? {} : { [url]: body }));
  const future = new Date(Date.now() + 90 * 86_400_000).toISOString();

  it('skips as not applicable when missing or HTML', async () => {
    expect((await run()).verdict).toBe('skip');
    const html = await run('<!doctype html><html><body>404</body></html>');
    expect(html.verdict).toBe('skip');
    expect(html.skipReason).toBe('not_applicable');
    expect(html.message).toBe('no security.txt; optional');
  });

  it('warns without a Contact, without a valid Expires, or when expired', async () => {
    const noContact = await run(`Expires: ${future}\n`);
    expect(noContact.verdict).toBe('warn');
    expect(noContact.message).toMatch(/Contact/);
    const noExpires = await run('Contact: mailto:security@shop.example\n');
    expect(noExpires.verdict).toBe('warn');
    expect(noExpires.message).toMatch(/Expires/);
    expect(noExpires.evidence).toMatchObject({ expires: null });
    const unparsable = await run('Contact: mailto:security@shop.example\nExpires: soon\n');
    expect(unparsable.verdict).toBe('warn');
    expect(unparsable.message).toMatch(/lacks a valid Expires/);
    const expired = await run(
      'Contact: mailto:security@shop.example\nExpires: 2020-01-01T00:00:00Z\n',
    );
    expect(expired.verdict).toBe('warn');
    expect(expired.message).toBe('security.txt has expired');
  });

  it('passes with a contact and a future Expires', async () => {
    const outcome = await run(`Contact: mailto:security@shop.example\nExpires: ${future}\n`);
    expect(outcome.verdict).toBe('pass');
    expect(outcome.evidence).toMatchObject({
      contacts: ['mailto:security@shop.example'],
      expires: future,
    });
  });
});

describe('B4 checks on the good WooCommerce fixture', () => {
  const fixture = join(
    dirname(fileURLToPath(import.meta.url)),
    '..',
    '..',
    '..',
    '..',
    '..',
    'fixtures',
    'stores',
    'good-woocommerce',
  );

  it('passes B4.4, B4.5 and B4.6', async () => {
    const fetcher = fixtureFetcher(fixture);
    const target = await resolveTarget('ceramics.example', fetcher);
    const identity = await runCheck(merchantIdentity, target, fetcher);
    expect(identity.verdict).toBe('pass');
    expect(identity.evidence).toMatchObject({
      organization: 'Example Ceramics GmbH',
      fields: ['name', 'address', 'contactPoint'],
      source: 'https://ceramics.example/',
    });
    const channel = await runCheck(contactChannel, target, fetcher);
    expect(channel.verdict).toBe('pass');
    expect(channel.evidence).toMatchObject({
      mailto: ['hello@ceramics.example'],
      contact_pages: ['https://ceramics.example/contact/'],
    });
    const readable = await runCheck(policyPagesAgentReadable, target, fetcher);
    expect(readable.verdict).toBe('pass');
    expect(readable.evidence).toMatchObject({ readable: 4, total: 4 });
  });
});
