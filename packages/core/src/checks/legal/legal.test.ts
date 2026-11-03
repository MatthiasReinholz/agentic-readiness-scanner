import type { Market } from '@agentic-readiness/catalog';
import { describe, expect, it } from 'vitest';

import type { Target } from '../../target/types.js';
import { mapFetcher, runCheck, targetFor, type TargetOptions } from '../../testing/index.js';
import {
  californiaOptOutLinks,
  globalPrivacyControl,
  libroDeReclamaciones,
  noOutdatedOdrLink,
  noTrackingBeforeConsent,
  privacyContact,
  privacyNoticeLinked,
  registrationNumbers,
  sellerIdentity,
} from './identity-privacy.js';
import {
  aiChatAssistant,
  aiImageMarking,
  genericGreenClaims,
  manufacturerInformation,
  priorLowestPrice,
  reviewVerification,
  swissPriceDisplay,
  tdmReservation,
} from './products-ai.js';
import {
  accessibilityFindings,
  accessibilityOverlay,
  accessibilityStatement,
  argentinaButtons,
  euWithdrawalFunction,
  staticAccessibilityBasics,
  statutoryReturnPeriod,
  subscriptionCancellation,
} from './withdrawal-accessibility.js';
import { HtmlDocument } from '../../parsers/html.js';

const ORIGIN = 'https://shop.example';
const page = (body: string, head = '') =>
  `<!doctype html><html lang="en"><head><title>Shop</title>${head}</head><body>${body}</body></html>`;

function target(markets: Market[], options: TargetOptions = {}): Target {
  return { ...targetFor(options), markets };
}

describe('market gate', () => {
  it('skips a market-bound check for a store that shows no sign of selling there', async () => {
    const outcome = await runCheck(libroDeReclamaciones, target(['EU']), mapFetcher({}));
    expect(outcome).toMatchObject({ verdict: 'skip', skipReason: 'not_applicable' });
    expect(outcome.message).toMatch(/no sign this store sells to Peru/);
  });
});

describe('C1 seller identity', () => {
  it('finds a legal name, an address and an email on the imprint', async () => {
    const imprint = `${ORIGIN}/impressum/`;
    const outcome = await runCheck(
      sellerIdentity,
      target(['EU'], { policies: { imprint } }),
      mapFetcher({
        [imprint]: page(
          '<p>Beispiel Keramik GmbH, Musterstraße 1, 10115 Berlin. E-Mail: hallo@shop.example</p>',
        ),
      }),
    );
    expect(outcome.verdict).toBe('pass');
  });

  it('asks for review when only a contact form is offered', async () => {
    const contact = `${ORIGIN}/contact/`;
    const outcome = await runCheck(
      sellerIdentity,
      target([], { policies: { contact } }),
      mapFetcher({
        [contact]: page(
          '<form><input name="message" aria-label="Message"></form><p>Example Ltd</p>',
        ),
      }),
    );
    expect(outcome.verdict).toBe('warn');
    expect(outcome.message).toMatch(/no postal address or email/);
  });

  it('checks the identifiers of each detected market, with check digits', async () => {
    const imprint = `${ORIGIN}/legal/`;
    const fetcher = mapFetcher({
      [imprint]: page('<p>USt-IdNr. DE123456789 · CNPJ 11.222.333/0001-82</p>'),
    });
    const outcome = await runCheck(
      registrationNumbers,
      target(['EU', 'BR'], { policies: { imprint } }),
      fetcher,
    );
    expect(outcome.verdict).toBe('warn');
    expect(outcome.message).toMatch(/found EU VAT ID.*check digit fails for Brazilian CNPJ/);
  });

  it('links the Libro de Reclamaciones for Peru, and flags the closed ODR platform for the EU', async () => {
    const peru = await runCheck(
      libroDeReclamaciones,
      target(['PE'], {
        homeHtml: page('<a href="/libro"><img src="/l.png" alt="Libro de Reclamaciones"></a>'),
      }),
      mapFetcher({}),
    );
    expect(peru.verdict).toBe('pass');
    const odr = await runCheck(
      noOutdatedOdrLink,
      target(['EU'], {
        homeHtml: page('<a href="https://ec.europa.eu/consumers/odr/">OS-Plattform</a>'),
      }),
      mapFetcher({}),
    );
    expect(odr.verdict).toBe('warn');
  });
});

describe('C2 privacy', () => {
  const privacy = `${ORIGIN}/privacy/`;

  it('finds a privacy notice with a contact and a named DPO', async () => {
    const fetcher = mapFetcher({
      [privacy]: page(
        '<p>Controller: Example GmbH. Our data protection officer can be reached at dpo@shop.example.</p>',
      ),
    });
    const t = target(['EU'], { policies: { privacy } });
    expect((await runCheck(privacyNoticeLinked, t, fetcher)).verdict).toBe('pass');
    expect((await runCheck(privacyContact, t, fetcher)).verdict).toBe('pass');
  });

  it('follows a home-page privacy link when the resolver found none', async () => {
    const fetcher = mapFetcher({
      [`${ORIGIN}/datenschutz/`]: page('<p>Beispiel GmbH, kontakt@shop.example</p>'),
    });
    const t = target(['EU'], {
      homeHtml: page('<footer><a href="/datenschutz/">Datenschutzerklärung</a></footer>'),
    });
    expect((await runCheck(privacyNoticeLinked, t, fetcher)).verdict).toBe('pass');
  });

  it('reports a missing privacy link as not found', async () => {
    expect((await runCheck(privacyNoticeLinked, target([]), mapFetcher({}))).verdict).toBe('fail');
  });

  it('finds the California opt-out link and asks for review without it', async () => {
    const found = await runCheck(
      californiaOptOutLinks,
      target(['US'], { homeHtml: page('<a href="/choices">Your Privacy Choices</a>') }),
      mapFetcher({}),
    );
    expect(found.verdict).toBe('pass');
    expect((await runCheck(californiaOptOutLinks, target(['US']), mapFetcher({}))).verdict).toBe(
      'warn',
    );
  });

  it('reads /.well-known/gpc.json', async () => {
    const fetcher = mapFetcher({
      [`${ORIGIN}/.well-known/gpc.json`]: '{"gpc": true, "lastUpdate": "2026-10-01"}',
    });
    expect((await runCheck(globalPrivacyControl, target(['US']), fetcher)).verdict).toBe('pass');
    const off = mapFetcher({ [`${ORIGIN}/.well-known/gpc.json`]: '{"gpc": false}' });
    expect((await runCheck(globalPrivacyControl, target(['US']), off)).verdict).toBe('warn');
  });

  it('sees advertising cookies and unblocked trackers, and accepts consent-blocked tags', async () => {
    const base = target(['EU'], {
      homeHtml: page('', '<script src="https://connect.facebook.net/en_US/fbevents.js"></script>'),
    });
    const withCookie: Target = {
      ...base,
      home: {
        ...base.home,
        headers: {
          ...base.home.headers,
          'set-cookie': '_fbp=fb.1.2; Path=/, session=abc; HttpOnly',
        },
      },
    };
    const cookie = await runCheck(noTrackingBeforeConsent, withCookie, mapFetcher({}));
    expect(cookie.verdict).toBe('warn');
    expect(cookie.message).toMatch(/advertising cookie\(s\).*_fbp/);
    expect((await runCheck(noTrackingBeforeConsent, base, mapFetcher({}))).message).toMatch(
      /Meta pixel/,
    );
    const blocked = target(['EU'], {
      homeHtml: page(
        '',
        '<script type="text/plain" data-cookieconsent="marketing" src="https://connect.facebook.net/en_US/fbevents.js"></script>',
      ),
    });
    expect((await runCheck(noTrackingBeforeConsent, blocked, mapFetcher({}))).verdict).toBe('pass');
  });
});

describe('C3 withdrawal, returns and cancellation', () => {
  it('passes the official label, reviews other wording, fails without a link', async () => {
    const official = target(['EU'], {
      homeHtml: page('<footer><a href="/widerruf">Vertrag widerrufen</a></footer>'),
    });
    expect((await runCheck(euWithdrawalFunction, official, mapFetcher({}))).verdict).toBe('pass');
    const other = target(['EU'], {
      homeHtml: page('<footer><a href="/widerruf">Widerrufsformular</a></footer>'),
    });
    expect((await runCheck(euWithdrawalFunction, other, mapFetcher({}))).verdict).toBe('warn');
    expect((await runCheck(euWithdrawalFunction, target(['EU']), mapFetcher({}))).verdict).toBe(
      'fail',
    );
  });

  it('expects the botón de baja only where subscriptions are sold', async () => {
    const onlyWithdrawal = target(['AR'], {
      homeHtml: page('<a href="/arrepentimiento">Botón de arrepentimiento</a>'),
    });
    expect((await runCheck(argentinaButtons, onlyWithdrawal, mapFetcher({}))).verdict).toBe('pass');
    const subscriptions = target(['AR'], {
      homeHtml: page(
        '<p>Suscripción mensual</p><a href="/arrepentimiento">Botón de arrepentimiento</a>',
      ),
    });
    expect((await runCheck(argentinaButtons, subscriptions, mapFetcher({}))).verdict).toBe('warn');
  });

  it('compares the stated return period with each market minimum', async () => {
    const returns = `${ORIGIN}/returns/`;
    const short = mapFetcher({ [returns]: page('<p>Returns accepted within 7 days.</p>') });
    const outcome = await runCheck(
      statutoryReturnPeriod,
      target(['EU', 'BR'], { policies: { returns } }),
      short,
    );
    expect(outcome.verdict).toBe('fail');
    expect(outcome.message).toMatch(/below 14 days in the EU/);
    const long = mapFetcher({ [returns]: page('<p>Rückgabe innerhalb von 30 Tagen.</p>') });
    expect(
      (await runCheck(statutoryReturnPeriod, target(['EU'], { policies: { returns } }), long))
        .verdict,
    ).toBe('pass');
  });

  it('looks for a cancellation route only when subscriptions are offered', async () => {
    expect((await runCheck(subscriptionCancellation, target(['US']), mapFetcher({}))).verdict).toBe(
      'skip',
    );
    const offered = target(['US'], {
      homeHtml: page(
        '<p>Subscribe &amp; save, billed monthly.</p><a href="/account/subscriptions">Manage subscriptions</a>',
      ),
    });
    expect((await runCheck(subscriptionCancellation, offered, mapFetcher({}))).verdict).toBe(
      'pass',
    );
  });
});

describe('C4 accessibility', () => {
  it('finds an accessibility statement by label or path', async () => {
    const t = target(['EU'], {
      homeHtml: page(
        '<footer><a href="/erklaerung-zur-barrierefreiheit">Barrierefreiheit</a></footer>',
      ),
    });
    expect((await runCheck(accessibilityStatement, t, mapFetcher({}))).verdict).toBe('pass');
    expect((await runCheck(accessibilityStatement, target(['EU']), mapFetcher({}))).verdict).toBe(
      'fail',
    );
  });

  it('lists the static basics a page misses', () => {
    const doc = new HtmlDocument(
      '<html><head><meta name="viewport" content="width=device-width, user-scalable=no"></head><body><img src="a.png"><input name="q"><a href="/x"></a><button><img src="i.svg" alt="Search"></button><label>Email <input name="e"></label></body></html>',
    );
    expect(accessibilityFindings(doc, `${ORIGIN}/`).problems).toEqual({
      lang: 'no lang attribute on the html element',
      title: 'no title',
      images_without_alt: 1,
      unlabelled_controls: 1,
      unnamed_links_and_buttons: 1,
      zoom_disabled: 'width=device-width, user-scalable=no',
    });
  });

  it('passes a page with the basics and names an overlay', async () => {
    const clean = target([], { homeHtml: page('<a href="/a">About</a><img src="a.png" alt="">') });
    expect((await runCheck(staticAccessibilityBasics, clean, mapFetcher({}))).verdict).toBe('pass');
    const overlay = target([], {
      homeHtml: page('', '<script src="https://acsbapp.com/apps/app/dist/js/app.js"></script>'),
    });
    const outcome = await runCheck(accessibilityOverlay, overlay, mapFetcher({}));
    expect(outcome).toMatchObject({ verdict: 'warn', evidence: { vendors: ['accessiBe'] } });
  });
});

describe('C5 product and price information', () => {
  const product = `${ORIGIN}/product/mug/`;

  it('finds the manufacturer with an address on product pages', async () => {
    const fetcher = mapFetcher({
      [product]: page(
        '<p>Hersteller: Beispiel Keramik GmbH, Musterstraße 1, 10115 Berlin, info@keramik.example</p>',
      ),
    });
    expect(
      (await runCheck(manufacturerInformation, target(['EU'], { products: [product] }), fetcher))
        .verdict,
    ).toBe('pass');
    const brandOnly = mapFetcher({
      [product]: page(
        '',
        '<script type="application/ld+json">{"@type":"Product","name":"Mug","manufacturer":"Keramik"}</script>',
      ),
    });
    expect(
      (await runCheck(manufacturerInformation, target(['EU'], { products: [product] }), brandOnly))
        .verdict,
    ).toBe('warn');
  });

  it('checks prior-price wording only where a reduced price is shown', async () => {
    const plain = mapFetcher({ [product]: page('<p>€19.00</p>') });
    expect(
      (await runCheck(priorLowestPrice, target(['EU'], { products: [product] }), plain)).verdict,
    ).toBe('skip');
    const reduced = mapFetcher({ [product]: page('<del>€29.00</del> <ins>€19.00</ins>') });
    expect(
      (await runCheck(priorLowestPrice, target(['EU'], { products: [product] }), reduced)).verdict,
    ).toBe('warn');
    const stated = mapFetcher({
      [product]: page('<del>€29.00</del> €19.00 · Lowest price in the last 30 days: €25.00'),
    });
    expect(
      (await runCheck(priorLowestPrice, target(['EU'], { products: [product] }), stated)).verdict,
    ).toBe('pass');
  });

  it('asks how reviews are checked when reviews are shown', async () => {
    const reviews = mapFetcher({
      [product]: page(
        '',
        '<script type="application/ld+json">{"@type":"Product","aggregateRating":{"@type":"AggregateRating","ratingValue":4.8,"reviewCount":12}}</script>',
      ),
    });
    expect(
      (await runCheck(reviewVerification, target(['EU'], { products: [product] }), reviews))
        .verdict,
    ).toBe('warn');
  });

  it('flags generic environmental claims and reads Swiss price display', async () => {
    const green = target(['EU'], { homeHtml: page('<p>Our climate neutral mugs.</p>') });
    expect((await runCheck(genericGreenClaims, green, mapFetcher({}))).verdict).toBe('warn');
    const swiss = mapFetcher({
      [product]: page(
        '<p>CHF 29.00 inkl. MWST</p>',
        '<script type="application/ld+json">{"@type":"Product","offers":{"@type":"Offer","price":"29.00","priceCurrency":"CHF"}}</script>',
      ),
    });
    expect(
      (await runCheck(swissPriceDisplay, target(['CH'], { products: [product] }), swiss)).verdict,
    ).toBe('pass');
  });
});

describe('C6 AI transparency and content rights', () => {
  it('names a chat assistant', async () => {
    const t = target(['EU'], {
      homeHtml: page('', '<script src="https://widget.intercom.io/widget/abc"></script>'),
    });
    expect(await runCheck(aiChatAssistant, t, mapFetcher({}))).toMatchObject({
      verdict: 'warn',
      evidence: { vendors: ['Intercom'] },
    });
  });

  it('passes a training-only reservation and warns when it also blocks search crawlers', async () => {
    const training = target(['EU'], {
      robots: 'User-agent: GPTBot\nDisallow: /\n\nUser-agent: *\nAllow: /\n',
      products: [`${ORIGIN}/product/mug/`],
    });
    expect((await runCheck(tdmReservation, training, mapFetcher({}))).verdict).toBe('pass');
    const everything = target(['EU'], {
      robots: 'User-agent: *\nDisallow: /\n',
      products: [`${ORIGIN}/product/mug/`],
    });
    const outcome = await runCheck(tdmReservation, everything, mapFetcher({}));
    expect(outcome.verdict).toBe('warn');
    expect(outcome.message).toMatch(/Googlebot/);
  });

  it('calls a terms-only reservation not machine-readable', async () => {
    const terms = `${ORIGIN}/terms/`;
    const t = target(['EU'], { policies: { terms } });
    const fetcher = mapFetcher({
      [terms]: page('<p>We reserve all rights to text and data mining under § 44b UrhG.</p>'),
    });
    const outcome = await runCheck(tdmReservation, t, fetcher);
    expect(outcome.verdict).toBe('warn');
    expect(outcome.message).toMatch(/nothing machine-readable/);
  });

  it('reports AI-generation metadata in a product image and stays silent without it', async () => {
    const product = `${ORIGIN}/product/mug/`;
    const image = `${ORIGIN}/mug.jpg`;
    const marked = mapFetcher({
      [product]: page('<img class="wp-post-image" src="/mug.jpg" alt="Mug">'),
      [image]:
        'JFIF... Iptc4xmpExt:DigitalSourceType="http://cv.iptc.org/newscodes/digitalsourcetype/trainedAlgorithmicMedia"',
    });
    expect(
      (await runCheck(aiImageMarking, target(['EU'], { products: [product] }), marked)).verdict,
    ).toBe('pass');
    const plain = mapFetcher({
      [product]: page('<img class="wp-post-image" src="/mug.jpg" alt="Mug">'),
      [image]: 'JFIF',
    });
    expect(
      (await runCheck(aiImageMarking, target(['EU'], { products: [product] }), plain)).verdict,
    ).toBe('skip');
  });
});
