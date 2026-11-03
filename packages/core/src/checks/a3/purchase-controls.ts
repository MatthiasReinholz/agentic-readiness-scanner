import { isTag, type Element } from 'domhandler';

import { accessibleName } from '../../parsers/accessible-name.js';
import { attribute, elementText, type HtmlDocument } from '../../parsers/html.js';
import { ADD_TO_CART } from '../../parsers/product-page.js';
import { fetchNote, readableProductPages } from '../shared.js';
import { defineCheck, fail, pass, skip, warn } from '../types.js';

/** A form that adds to the cart: Shopify's /cart/add, WooCommerce's add-to-cart parameter. */
const CART_FORM_ACTION = /\/cart\/add|add[-_]to[-_]cart|[?&]add-to-cart=/i;
const CONTROL_TAGS = new Set(['button', 'input', 'select', 'textarea']);
const UNNAMED_SAMPLE = 5;

function isControl(element: Element): boolean {
  if (!CONTROL_TAGS.has(element.name)) return false;
  if (element.name === 'input' && /^hidden$/i.test(attribute(element, 'type') ?? '')) return false;
  return attribute(element, 'aria-hidden') !== 'true';
}

function descendants(root: Element): Element[] {
  const found: Element[] = [];
  const walk = (node: Element): void => {
    for (const child of node.children) {
      if (isTag(child)) {
        found.push(child);
        walk(child);
      }
    }
  };
  walk(root);
  return found;
}

function enclosingForm(element: Element): Element | null {
  let node = element.parent;
  while (node) {
    if (isTag(node) && node.name === 'form') return node;
    node = node.parent;
  }
  return null;
}

/** "button.single_add_to_cart_button", "select#pa_size": enough to find the control. */
function describe(element: Element): string {
  const id = attribute(element, 'id');
  const name = attribute(element, 'name');
  const type = element.name === 'input' ? `[type=${attribute(element, 'type') ?? 'text'}]` : '';
  return `${element.name}${type}${id ? `#${id}` : name ? `[name=${name}]` : ''}`;
}

/** The add-to-cart control: named like one, or the submit button of a cart form. */
function addToCartControl(doc: HtmlDocument): Element | null {
  const controls = [...doc.elements('button'), ...doc.elements('input')].filter(isControl);
  const byName = controls.find((element) =>
    ADD_TO_CART.test(
      [
        attribute(element, 'name'),
        attribute(element, 'class'),
        attribute(element, 'id'),
        attribute(element, 'value'),
        attribute(element, 'aria-label'),
        elementText(element),
      ].join(' '),
    ),
  );
  if (byName) return byName;
  const form = doc
    .elements('form')
    .find((candidate) => CART_FORM_ACTION.test(attribute(candidate, 'action') ?? ''));
  if (!form) return null;
  return (
    descendants(form).find(
      (element) =>
        isControl(element) &&
        (element.name === 'button' || /^(?:submit|image)$/i.test(attribute(element, 'type') ?? '')),
    ) ?? null
  );
}

export const purchaseControlsNamed = defineCheck('A3.14', async ({ target, fetcher }) => {
  const { pages, unavailable } = await readableProductPages(target, fetcher);
  if (unavailable) return unavailable;
  const note = fetchNote(target, pages);
  const findings: Record<string, unknown>[] = [];
  for (const page of pages) {
    const button = addToCartControl(page.doc);
    if (!button) continue;
    const form = enclosingForm(button);
    const controls = form ? descendants(form).filter(isControl) : [button];
    const unnamed = controls.filter((element) => !accessibleName(page.doc, element));
    findings.push({
      url: page.url,
      add_to_cart: describe(button),
      add_to_cart_name: accessibleName(page.doc, button) || null,
      controls: controls.length,
      unnamed: unnamed.map(describe),
    });
  }
  const evidence = { pages: findings };
  if (findings.length === 0) {
    return skip(
      'not_applicable',
      `no add-to-cart control in the server HTML of ${pages.length} sampled product page(s), so there was nothing to read. A3.2 covers content that needs JavaScript${note}`,
      evidence,
    );
  }
  const silentButtons = findings.filter((finding) => finding.add_to_cart_name === null);
  if (silentButtons.length > 0) {
    return fail(
      `the add-to-cart control has no accessible name on ${silentButtons.length} of ${findings.length} product page(s) (${String(silentButtons[0]?.add_to_cart)}), so a browser agent cannot tell what it does${note}`,
      evidence,
    );
  }
  const unnamed = findings.flatMap((finding) => finding.unnamed as string[]);
  if (unnamed.length > 0) {
    return warn(
      `${unnamed.length} control(s) in the purchase form have no accessible name, for example ${[...new Set(unnamed)].slice(0, UNNAMED_SAMPLE).join(', ')}${note}`,
      evidence,
    );
  }
  const total = findings.reduce((sum, finding) => sum + Number(finding.controls), 0);
  return pass(
    `every control in the purchase form has an accessible name (${total} control(s) on ${findings.length} product page(s))${note}`,
    evidence,
  );
});
