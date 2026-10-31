import { HtmlDocument, elementText } from '../../parsers/html.js';
import { storeApiUrl } from '../shared.js';
import { defineCheck, fail, pass, warn } from '../types.js';

/** The Store API cart object, as far as this check dereferences it. */
interface StoreApiCart {
  items: unknown[];
  totals: Record<string, unknown>;
  items_count?: unknown;
}

function parseCart(body: string): StoreApiCart | null {
  try {
    const parsed: unknown = JSON.parse(body);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
    const record = parsed as Record<string, unknown>;
    if (!Array.isArray(record.items)) return null;
    if (!record.totals || typeof record.totals !== 'object' || Array.isArray(record.totals)) {
      return null;
    }
    return {
      items: record.items,
      totals: record.totals as Record<string, unknown>,
      items_count: record.items_count,
    };
  } catch {
    return null;
  }
}

/** The checkout page: the first same-origin home-page link to /checkout/, else the default. */
export function checkoutUrl(
  origin: string,
  anchors: { href: string }[],
): { url: string; source: 'home-link' | 'default' } {
  for (const anchor of anchors) {
    try {
      const url = new URL(anchor.href, origin);
      if (url.origin !== origin) continue;
      if (/^\/checkout\/?$/i.test(url.pathname)) {
        url.hash = '';
        url.search = '';
        return { url: url.href, source: 'home-link' };
      }
    } catch {
      // not a URL
    }
  }
  return { url: `${origin}/checkout/`, source: 'default' };
}

/**
 * The notices WooCommerce prints when guest checkout is disabled. Every alternative is a
 * fixed phrase, so matching stays linear on the capped notice text.
 */
const LOGIN_REQUIRED_NOTICE =
  /must be logged in to (?:checkout|check out|proceed)|log ?in to (?:checkout|check out|proceed)|please log ?in|sign in to (?:checkout|check out|proceed)/i;
const NOTICE_TEXT_LIMIT = 2_000;

export interface CheckoutLoginSignals {
  checkout_form: boolean;
  login_form: boolean;
  login_notice: boolean;
  login_required: boolean;
}

/**
 * Conservative reading of a checkout page: login is required only when a login notice or
 * login form is present and no checkout form is. A page that shows both (a login prompt
 * above a guest checkout form) still offers guest checkout.
 */
export function checkoutLoginSignals(doc: HtmlDocument): CheckoutLoginSignals {
  const checkoutForm =
    doc.find('form', 'class', /\bcheckout\b/).length > 0 ||
    doc.find('form', 'name', /^checkout$/i).length > 0 ||
    doc.find('*', 'class', /\bwp-block-woocommerce-checkout\b|\bwc-block-checkout\b/).length > 0;
  const loginForm = doc.find('form', 'class', /\bwoocommerce-form-login\b/).length > 0;
  const notices = doc.find(
    '*',
    'class',
    /\bwoocommerce-info\b|\bwoocommerce-message\b|\bwoocommerce-error\b|\bwc-block-components-notice-banner\b/,
  );
  const loginNotice = notices.some((notice) =>
    LOGIN_REQUIRED_NOTICE.test(elementText(notice).slice(0, NOTICE_TEXT_LIMIT)),
  );
  return {
    checkout_form: checkoutForm,
    login_form: loginForm,
    login_notice: loginNotice,
    login_required: (loginNotice || loginForm) && !checkoutForm,
  };
}

export const guestCheckoutAndCartApi = defineCheck('B5.7', async ({ target, fetcher }) => {
  const cartUrl = storeApiUrl(target, '/cart');
  const cartResponse = await fetcher.fetch(cartUrl);
  const evidence: Record<string, unknown> = {
    cart_url: cartUrl,
    cart_status: cartResponse.status,
  };
  if (cartResponse.status === 401 || cartResponse.status === 403) {
    return fail(`cart requires authentication (HTTP ${cartResponse.status})`, evidence);
  }
  if (cartResponse.status === 404) {
    return fail('Store API cart endpoint not found (HTTP 404)', evidence);
  }
  if (cartResponse.status !== 200) {
    return fail(
      cartResponse.status === 0
        ? `Store API cart could not be fetched: ${cartResponse.error ?? 'no response'}`
        : `Store API cart returned HTTP ${cartResponse.status}`,
      evidence,
    );
  }
  const cart = parseCart(cartResponse.body);
  if (!cart) {
    return fail('Store API cart is not a JSON object with items and totals', evidence);
  }
  evidence.cart_items = cart.items.length;
  evidence.cart_currency_code =
    typeof cart.totals.currency_code === 'string' ? cart.totals.currency_code : null;

  const checkout = checkoutUrl(target.origin, target.homeDoc.anchors());
  const checkoutResponse = await fetcher.fetch(checkout.url);
  evidence.checkout_url = checkout.url;
  evidence.checkout_url_source = checkout.source;
  evidence.checkout_status = checkoutResponse.status;
  if (checkoutResponse.status !== 200) {
    evidence.login_required = null;
    return pass(
      `anonymous cart API works; checkout page returned HTTP ${checkoutResponse.status}, so guest checkout was not verified`,
      evidence,
    );
  }
  const signals = checkoutLoginSignals(new HtmlDocument(checkoutResponse.body));
  Object.assign(evidence, signals);
  if (signals.login_required) {
    return warn(
      'anonymous cart API works, but the checkout page requires login (guest checkout disabled)',
      evidence,
    );
  }
  return pass('anonymous cart API works and the checkout page does not require login', evidence);
});
