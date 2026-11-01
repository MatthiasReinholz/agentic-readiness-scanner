/**
 * Recognising a product page from its HTML alone, for the resolver (sampling pages whose
 * URLs match no product pattern) and the policy checks (rejecting a product that was
 * linked with a policy word in its name).
 */
import type { HtmlDocument } from './html.js';
import { extractJsonLd, productNodes } from './jsonld.js';

/** Controls or links whose name, class, id, value or text say they add the item to the cart. */
export const ADD_TO_CART =
  /add[-_ ]?to[-_ ]?(?:cart|bag|basket)|single_add_to_cart_button|buy now|in den (?:warenkorb|einkaufswagen)|ajouter au panier|aggiungi al carrello|a(?:ñ|n)adir al carrito|in winkelwagen/i;

/**
 * True when the document is marked up as a product: Product JSON-LD or og:type product.
 * The strict test for pages that must not be products (a policy page); theme chrome on
 * platforms such as Shopify carries add-to-cart controls on every page, so those do not
 * count here.
 */
export function hasProductMarkup(doc: HtmlDocument): boolean {
  if (productNodes(extractJsonLd(doc).nodes).length > 0) return true;
  return (doc.meta('og:type') ?? '').toLowerCase().startsWith('product');
}

/** True when a document carries Product JSON-LD or an add-to-cart control or link. */
export function looksLikeProductPage(doc: HtmlDocument): boolean {
  if (hasProductMarkup(doc)) return true;
  if (
    doc
      .controls()
      .some((control) =>
        ADD_TO_CART.test(
          `${control.name ?? ''} ${control.className ?? ''} ${control.id ?? ''} ${control.value ?? ''} ${control.text}`,
        ),
      )
  )
    return true;
  return doc.anchors().some((anchor) => ADD_TO_CART.test(anchor.text));
}
