/**
 * B5.12: whether a WooCommerce store's cart and checkout pages use WooCommerce's Cart and
 * Checkout blocks or the classic shortcodes. A technology check: it records the choice
 * and is never scored.
 *
 * The cart page is read as served (with an empty cart). Many stores keep /cart/ and
 * /checkout/ out of robots.txt, which the scanner honours, and the checkout page
 * redirects to the cart while the cart is empty, so both pages are also read through the
 * WordPress REST API, which renders the page's content.
 */
import type { TechnologyFact } from '@agentic-readiness/catalog';

import type { Fetcher, FetchedResponse } from '../../http/types.js';
import { HtmlDocument } from '../../parsers/html.js';
import {
  addToCartCartUrl,
  readCartPage,
  readPageContent,
  readWooSettings,
  type StorePage,
  type WooPageKind,
  type WooPageReading,
  type WooSettings,
} from '../../parsers/wordpress.js';
import type { Target } from '../../target/types.js';
import { isRecord, parseJson } from '../json.js';
import { blockedByRobots, describeFailure, isTransient } from '../shared.js';
import { defineCheck, pass, skip } from '../types.js';
import { restApiRoot, restRoute } from './wordpress.js';

type Page = 'cart' | 'checkout';
type CartUrlSource = 'store-pages' | 'add-to-cart-params' | 'default';

const VALUE: Record<Page, Record<WooPageKind, string>> = {
  cart: { block: 'Cart block', classic: 'Classic cart (shortcode, page builder or plugin)' },
  checkout: {
    block: 'Checkout block',
    classic: 'Classic checkout (shortcode, page builder or plugin)',
  },
};

const PHRASE: Record<Page, Record<WooPageKind, string>> = {
  cart: {
    block: 'the cart uses the Cart block',
    classic: 'the cart is not the Cart block (the classic shortcode, a page builder or a plugin)',
  },
  checkout: {
    block: 'the checkout uses the Checkout block',
    classic:
      'the checkout is not the Checkout block (the classic shortcode, a page builder or a checkout plugin)',
  },
};

const NOT_READ: WooPageReading = { kind: null, signal: null };

function sameOrigin(url: string, origin: string): string | null {
  try {
    const parsed = new URL(url, origin);
    return parsed.origin === origin ? parsed.href : null;
  } catch {
    return null;
  }
}

/** The last path segment of a page URL: its slug in WordPress's default permalinks. */
function slugOf(url: string | null, fallback: string): string {
  if (!url) return fallback;
  try {
    return new URL(url).pathname.split('/').filter(Boolean).pop() ?? fallback;
  } catch {
    return fallback;
  }
}

/** The cart page a page names: WooCommerce's settings first, then the add-to-cart script. */
function cartUrlIn(
  doc: HtmlDocument,
  settings: WooSettings | null,
  origin: string,
): { cartUrl: string; source: CartUrlSource } | null {
  const permalink = settings?.cart?.permalink;
  const fromSettings = permalink ? sameOrigin(permalink, origin) : null;
  if (fromSettings) return { cartUrl: fromSettings, source: 'store-pages' };
  const fromParams = addToCartCartUrl(doc);
  const cartUrl = fromParams ? sameOrigin(fromParams, origin) : null;
  return cartUrl ? { cartUrl, source: 'add-to-cart-params' } : null;
}

interface SitePages {
  settings: WooSettings | null;
  cartUrl: string | null;
  source: CartUrlSource;
}

/** The pages WooCommerce's scripts name, read from the home page, then a product page. */
async function wooPagesFromSite(target: Target, fetcher: Fetcher): Promise<SitePages> {
  let settings = readWooSettings(target.homeDoc);
  let found = cartUrlIn(target.homeDoc, settings, target.origin);
  const product = target.sampled.products[0];
  if (!found && product !== undefined) {
    const response = await fetcher.fetch(product);
    if (response.status === 200) {
      const doc = new HtmlDocument(response.body);
      settings ??= readWooSettings(doc);
      found = cartUrlIn(doc, settings, target.origin);
    }
  }
  return found ? { settings, ...found } : { settings, cartUrl: null, source: 'default' };
}

/** Why a response could not be read, as a phrase: "the cart page answered HTTP 404". */
function failurePhrase(what: string, response: FetchedResponse, about = ''): string {
  if (blockedByRobots(response)) return `robots.txt disallows ${what} for the scanner`;
  return `${what} answered ${describeFailure(response)}${about}`;
}

interface RestReading extends WooPageReading {
  url: string;
  status: number;
  note: string | null;
  response: FetchedResponse;
}

/**
 * A store page's content through the REST API: by the id WooCommerce's settings name,
 * else by the slug of its address (`cart` and `checkout` by default).
 */
async function readThroughRest(
  target: Target,
  fetcher: Fetcher,
  page: Page,
  storePage: StorePage | null,
  url: string | null,
): Promise<RestReading> {
  const { root } = restApiRoot(target);
  const fields = { _fields: 'id,link,content' };
  const slug = slugOf(storePage?.permalink ?? url, page);
  const restUrl = storePage?.id
    ? restRoute(root, `wp/v2/pages/${String(storePage.id)}`, fields)
    : restRoute(root, 'wp/v2/pages', { slug, ...fields });
  const response = await fetcher.fetch(restUrl, { headers: { accept: 'application/json' } });
  const reading = { url: restUrl, status: response.status, response };
  if (response.status !== 200) {
    return {
      ...reading,
      ...NOT_READ,
      note: failurePhrase('the REST API', response, ` for the ${page} page`),
    };
  }
  const parsed = parseJson(response.body);
  const entry: unknown = Array.isArray(parsed) ? parsed[0] : parsed;
  const rendered =
    isRecord(entry) && isRecord(entry.content) && typeof entry.content.rendered === 'string'
      ? entry.content.rendered
      : null;
  if (rendered === null) {
    const note = storePage?.id
      ? `the REST API returned no content for the ${page} page`
      : `the REST API lists no page with the slug "${slug}"`;
    return { ...reading, ...NOT_READ, note };
  }
  const result = readPageContent(rendered, page);
  return {
    ...reading,
    ...result,
    note: result.kind
      ? null
      : `the ${page} page's content is empty, so a template or plugin renders it, which the REST API does not show`,
  };
}

export const woocommerceCartAndCheckout = defineCheck('B5.12', async ({ target, fetcher }) => {
  const evidence: Record<string, unknown> = {};
  const site = await wooPagesFromSite(target, fetcher);
  const cartUrl = site.cartUrl ?? `${target.origin}/cart/`;
  evidence.cart_url = cartUrl;
  evidence.cart_url_source = site.source;

  // The cart page as served: the strongest evidence, when robots.txt lets the scanner in.
  const cartResponse = await fetcher.fetch(cartUrl);
  evidence.cart_status = cartResponse.status;
  let cart: WooPageReading = NOT_READ;
  let cartNote: string | null = null;
  let settings = site.settings;
  if (cartResponse.status === 200) {
    const doc = new HtmlDocument(cartResponse.body);
    cart = readCartPage(doc);
    // The Cart block prints WooCommerce's settings, which name both pages by id.
    const cartSettings = readWooSettings(doc);
    if (cartSettings?.checkout || cartSettings?.cart) settings = cartSettings;
    if (!cart.kind) cartNote = 'the cart page shows neither the Cart block nor the classic cart';
  } else {
    cartNote = failurePhrase('the cart page', cartResponse);
  }
  evidence.cart_read_from = cart.kind ? 'page' : null;

  const responses: FetchedResponse[] = [cartResponse];
  if (!cart.kind) {
    const rest = await readThroughRest(target, fetcher, 'cart', settings?.cart ?? null, cartUrl);
    evidence.cart_rest_url = rest.url;
    evidence.cart_rest_status = rest.status;
    responses.push(rest.response);
    if (rest.kind) {
      cart = rest;
      cartNote = null;
      evidence.cart_read_from = 'rest-api';
    } else {
      cartNote = [cartNote, rest.note].filter(Boolean).join('; ');
    }
  }
  evidence.cart_signal = cart.signal;

  const checkoutRest = await readThroughRest(
    target,
    fetcher,
    'checkout',
    settings?.checkout ?? null,
    null,
  );
  responses.push(checkoutRest.response);
  evidence.checkout_rest_url = checkoutRest.url;
  evidence.checkout_rest_status = checkoutRest.status;
  evidence.checkout_signal = checkoutRest.signal;
  const checkout: WooPageReading = checkoutRest;
  const checkoutNote = checkoutRest.note;

  const facts: TechnologyFact[] = [];
  const valueOf = (page: Page, reading: WooPageReading): string | null => {
    if (!reading.kind) return null;
    if (reading.kind === 'classic' && reading.shortcode)
      return page === 'cart' ? 'Classic cart (shortcode)' : 'Classic checkout (shortcode)';
    return VALUE[page][reading.kind];
  };
  const cartValue = valueOf('cart', cart);
  if (cartValue) facts.push({ label: 'Cart', value: cartValue });
  const checkoutValue = valueOf('checkout', checkout);
  if (checkoutValue) facts.push({ label: 'Checkout', value: checkoutValue });
  evidence.facts = facts;

  if (facts.length === 0) {
    const transient = responses.some(
      (response) => isTransient(response) && !blockedByRobots(response),
    );
    return skip(
      'error',
      `neither the cart nor the checkout type could be read: ${[cartNote, checkoutNote].filter(Boolean).join('; ')}${transient ? '. A temporary error was among the answers, so a rescan may read them' : ''}`,
      evidence,
    );
  }
  const phraseOf = (page: Page, reading: WooPageReading, note: string | null): string => {
    if (!reading.kind) return `the ${page} type could not be read (${note ?? 'no answer'})`;
    if (reading.kind === 'classic' && reading.shortcode)
      return `the ${page} uses the classic [woocommerce_${page}] shortcode`;
    return PHRASE[page][reading.kind];
  };
  const cartPart = phraseOf('cart', cart, cartNote);
  const checkoutPart = phraseOf('checkout', checkout, checkoutNote);
  return pass(`${cartPart}, and ${checkoutPart}`, evidence);
});
