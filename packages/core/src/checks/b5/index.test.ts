import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { HtmlDocument } from '../../parsers/html.js';
import {
  fixtureFetcher,
  mapFetcher,
  runCheck,
  targetFor,
  type MapResponse,
} from '../../testing/index.js';
import { checkoutLoginSignals, checkoutUrl, guestCheckoutAndCartApi } from './index.js';

const ORIGIN = 'https://shop.example';
const CART = `${ORIGIN}/wp-json/wc/store/v1/cart`;
const CHECKOUT = `${ORIGIN}/checkout/`;
const GOOD_FIXTURE = join(
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

const EMPTY_CART = JSON.stringify({
  items: [],
  items_count: 0,
  totals: { currency_code: 'EUR', total_price: '0' },
});
const cartOk: MapResponse = {
  status: 200,
  headers: { 'content-type': 'application/json' },
  body: EMPTY_CART,
};

function page(body: string): string {
  return `<!doctype html><html><head><title>Checkout</title></head><body>${body}</body></html>`;
}
const GUEST_CHECKOUT = page(
  '<form name="checkout" class="checkout woocommerce-checkout"><input name="billing_email"></form>',
);
const LOGIN_WALL = page(
  '<div class="woocommerce-info">You must be logged in to checkout.</div><form class="woocommerce-form woocommerce-form-login login"><input name="username"></form>',
);

describe('B5.7 Guest checkout and cart API', () => {
  const run = (record: Record<string, MapResponse>, homeHtml?: string) =>
    runCheck(
      guestCheckoutAndCartApi,
      targetFor(homeHtml === undefined ? {} : { homeHtml }),
      mapFetcher(record),
    );

  it('passes when the cart answers anonymously and the checkout page has a checkout form', async () => {
    const outcome = await run({ [CART]: cartOk, [CHECKOUT]: GUEST_CHECKOUT });
    expect(outcome.verdict).toBe('pass');
    expect(outcome.evidence).toEqual({
      cart_url: CART,
      cart_status: 200,
      cart_items: 0,
      cart_currency_code: 'EUR',
      checkout_url: CHECKOUT,
      checkout_url_source: 'default',
      checkout_status: 200,
      checkout_form: true,
      login_form: false,
      login_notice: false,
      login_required: false,
    });
  });

  it('warns when the checkout page requires login and shows no checkout form', async () => {
    const outcome = await run({ [CART]: cartOk, [CHECKOUT]: LOGIN_WALL });
    expect(outcome.verdict).toBe('warn');
    expect(outcome.message).toMatch(/guest checkout disabled/);
    expect(outcome.evidence).toMatchObject({
      checkout_url: CHECKOUT,
      checkout_status: 200,
      checkout_form: false,
      login_form: true,
      login_notice: true,
      login_required: true,
    });
  });

  it('still passes when a login prompt sits next to a guest checkout form', async () => {
    const outcome = await run({
      [CART]: cartOk,
      [CHECKOUT]: page(
        '<div class="woocommerce-info">Returning customer? Please log in.</div>' +
          '<div class="wp-block-woocommerce-checkout"></div>',
      ),
    });
    expect(outcome.verdict).toBe('pass');
    expect(outcome.evidence).toMatchObject({
      checkout_form: true,
      login_notice: true,
      login_required: false,
    });
  });

  it('passes on the cart but notes when the checkout page cannot be fetched', async () => {
    const outcome = await run({ [CART]: cartOk });
    expect(outcome.verdict).toBe('pass');
    expect(outcome.message).toMatch(/HTTP 404/);
    expect(outcome.evidence).toMatchObject({ checkout_status: 404, login_required: null });
  });

  it('takes the checkout URL from a home-page link when there is one', async () => {
    const linked = `${ORIGIN}/checkout`;
    const outcome = await run(
      { [CART]: cartOk, [linked]: GUEST_CHECKOUT },
      page('<a href="/cart/">Cart</a><a href="/checkout#top">Checkout</a>'),
    );
    expect(outcome.verdict).toBe('pass');
    expect(outcome.evidence).toMatchObject({
      checkout_url: linked,
      checkout_url_source: 'home-link',
      checkout_status: 200,
    });
  });

  it('fails when the cart requires authentication', async () => {
    for (const status of [401, 403]) {
      const outcome = await run({ [CART]: { status, body: '{"code":"rest_forbidden"}' } });
      expect(outcome.verdict, `HTTP ${status}`).toBe('fail');
      expect(outcome.message).toBe(`cart requires authentication (HTTP ${status})`);
      expect(outcome.evidence).toEqual({ cart_url: CART, cart_status: status });
    }
  });

  it('fails when the cart endpoint is missing', async () => {
    const outcome = await run({});
    expect(outcome.verdict).toBe('fail');
    expect(outcome.message).toBe('Store API cart endpoint not found (HTTP 404)');
    expect(outcome.evidence).toEqual({ cart_url: CART, cart_status: 404 });
  });

  it('fails on other statuses and when nothing answered', async () => {
    const server = await run({ [CART]: { status: 500, body: '' } });
    expect(server.verdict).toBe('fail');
    expect(server.message).toBe('Store API cart returned HTTP 500');
    const network = await run({ [CART]: { status: 0 } });
    expect(network.verdict).toBe('fail');
    expect(network.message).toMatch(/could not be fetched/);
  });

  it('fails without throwing when the cart body is not a cart object', async () => {
    for (const body of ['[]', '{"items":{}}', '{"items":[]}', '{"items":[],"totals":[]}', '{"it']) {
      const outcome = await run({ [CART]: { status: 200, body } });
      expect(outcome.verdict, body).toBe('fail');
      expect(outcome.message).toBe('Store API cart is not a JSON object with items and totals');
    }
  });

  it('passes on the good WooCommerce fixture', async () => {
    const outcome = await runCheck(
      guestCheckoutAndCartApi,
      targetFor({ origin: 'https://ceramics.example' }),
      fixtureFetcher(GOOD_FIXTURE),
    );
    expect(outcome.verdict).toBe('pass');
    expect(outcome.evidence).toMatchObject({
      cart_status: 200,
      cart_currency_code: 'EUR',
      checkout_url: 'https://ceramics.example/checkout/',
      checkout_status: 200,
      login_required: false,
    });
  });
});

describe('checkout page helpers', () => {
  it('prefers a same-origin /checkout/ link and ignores other origins and paths', () => {
    expect(checkoutUrl(ORIGIN, [])).toEqual({ url: CHECKOUT, source: 'default' });
    expect(
      checkoutUrl(ORIGIN, [
        { href: 'https://other.example/checkout/' },
        { href: '/checkout-guide/' },
        { href: '/Checkout/?step=1' },
      ]),
    ).toEqual({ url: `${ORIGIN}/Checkout/`, source: 'home-link' });
    expect(checkoutUrl(ORIGIN, [{ href: 'http://[bad' }])).toEqual({
      url: CHECKOUT,
      source: 'default',
    });
  });

  it('reads login signals conservatively', () => {
    const signals = (html: string) => checkoutLoginSignals(new HtmlDocument(page(html)));
    expect(signals('<p>You must be logged in to checkout.</p>')).toMatchObject({
      login_notice: false,
      login_required: false,
    });
    expect(
      signals('<div class="wc-block-components-notice-banner is-error">Log in to checkout</div>'),
    ).toMatchObject({ login_notice: true, checkout_form: false, login_required: true });
    expect(signals('<form class="woocommerce-form-login"></form>')).toMatchObject({
      login_form: true,
      login_required: true,
    });
    expect(signals('<form class="checkout"></form>')).toMatchObject({
      checkout_form: true,
      login_required: false,
    });
  });
});
