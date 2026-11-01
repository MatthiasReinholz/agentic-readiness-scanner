/**
 * Thin HTML helpers over htmlparser2. Checks never parse HTML themselves.
 */
import { isTag, isText, type AnyNode, type Document, type Element } from 'domhandler';
import { findAll, getAttributeValue, getElementsByTagName, textContent } from 'domutils';
import { parseDocument } from 'htmlparser2';

export interface Anchor {
  href: string;
  text: string;
  /** True inside a footer landmark, or an element whose id or class names a footer. */
  inFooter: boolean;
}

export interface LinkTag {
  rel: string;
  href: string;
  type?: string;
  hreflang?: string;
  title?: string;
}

/** A button or input: the attributes and text a check needs to tell what it does. */
export interface Control {
  tag: 'button' | 'input';
  type?: string;
  name?: string;
  id?: string;
  className?: string;
  value?: string;
  text: string;
}

const NON_CONTENT_TAGS = new Set(['script', 'style', 'template', 'noscript', 'svg']);

function isFooter(element: Element): boolean {
  if (element.name === 'footer') return true;
  if ((getAttributeValue(element, 'role') ?? '').toLowerCase() === 'contentinfo') return true;
  return /footer|colophon/i.test(
    `${getAttributeValue(element, 'id') ?? ''} ${getAttributeValue(element, 'class') ?? ''}`,
  );
}

function hasFooterAncestor(element: Element): boolean {
  let node: AnyNode | null = element.parent;
  while (node) {
    if (isTag(node) && isFooter(node)) return true;
    node = node.parent;
  }
  return false;
}

function hasRelToken(rel: string, token: string): boolean {
  return rel.toLowerCase().split(/\s+/).includes(token);
}

export class HtmlDocument {
  readonly dom: Document;

  constructor(html: string) {
    this.dom = parseDocument(html, { lowerCaseTags: true, lowerCaseAttributeNames: true });
  }

  elements(tagName: string): Element[] {
    return getElementsByTagName(tagName, this.dom, true);
  }

  title(): string | null {
    const title = this.elements('title')[0];
    return title ? textContent(title).trim() : null;
  }

  meta(name: string): string | null {
    for (const element of this.elements('meta')) {
      const key = getAttributeValue(element, 'name') ?? getAttributeValue(element, 'property');
      if (key?.toLowerCase() === name.toLowerCase())
        return getAttributeValue(element, 'content') ?? null;
    }
    return null;
  }

  links(): LinkTag[] {
    const result: LinkTag[] = [];
    for (const element of this.elements('link')) {
      const rel = getAttributeValue(element, 'rel');
      const href = getAttributeValue(element, 'href');
      if (!rel || !href) continue;
      const type = getAttributeValue(element, 'type');
      const hreflang = getAttributeValue(element, 'hreflang');
      const title = getAttributeValue(element, 'title');
      result.push({
        rel: rel.toLowerCase(),
        href,
        ...(type ? { type } : {}),
        ...(hreflang ? { hreflang } : {}),
        ...(title ? { title } : {}),
      });
    }
    return result;
  }

  /** Every button and input, with the attributes and text that say what it does. */
  controls(): Control[] {
    const result: Control[] = [];
    const read = (element: Element, tag: 'button' | 'input'): Control => {
      const type = getAttributeValue(element, 'type');
      const name = getAttributeValue(element, 'name');
      const id = getAttributeValue(element, 'id');
      const className = getAttributeValue(element, 'class');
      const value = getAttributeValue(element, 'value');
      return {
        tag,
        ...(type ? { type } : {}),
        ...(name ? { name } : {}),
        ...(id ? { id } : {}),
        ...(className ? { className } : {}),
        ...(value ? { value } : {}),
        text: elementText(element),
      };
    };
    for (const element of this.elements('button')) result.push(read(element, 'button'));
    for (const element of this.elements('input')) result.push(read(element, 'input'));
    return result;
  }

  anchors(): Anchor[] {
    const result: Anchor[] = [];
    for (const element of this.elements('a')) {
      const href = getAttributeValue(element, 'href');
      if (!href) continue;
      result.push({
        href,
        text: textContent(element).replace(/\s+/g, ' ').trim(),
        inFooter: hasFooterAncestor(element),
      });
    }
    return result;
  }

  /**
   * Hostnames of assets (script src, link href, img src), lower-cased, resolved against
   * `base`, so relative and protocol-relative URLs count too. Unparsable URLs are skipped.
   */
  assetHosts(base: string): Set<string> {
    const hosts = new Set<string>();
    const add = (value: string | undefined): void => {
      if (!value) return;
      try {
        const url = new URL(value, base);
        if (url.protocol === 'http:' || url.protocol === 'https:') hosts.add(url.hostname);
      } catch {
        // not a URL
      }
    };
    for (const element of this.elements('script')) add(getAttributeValue(element, 'src'));
    for (const element of this.elements('link')) add(getAttributeValue(element, 'href'));
    for (const element of this.elements('img')) add(getAttributeValue(element, 'src'));
    return hosts;
  }

  /** The `lang` attribute of the root element, or null. */
  lang(): string | null {
    const html = this.elements('html')[0];
    const lang = (html ? getAttributeValue(html, 'lang') : undefined)?.trim();
    return lang === undefined || lang === '' ? null : lang;
  }

  /** `src` of every external script, in document order (unresolved). */
  externalScripts(): string[] {
    return this.elements('script')
      .map((element) => getAttributeValue(element, 'src'))
      .filter((src): src is string => typeof src === 'string' && src.trim() !== '');
  }

  /** `href` of every `<link rel=stylesheet>`, in document order (unresolved). */
  stylesheets(): string[] {
    return this.links()
      .filter((link) => hasRelToken(link.rel, 'stylesheet'))
      .map((link) => link.href);
  }

  /** Trimmed text of every heading of the given level (1 to 6), in document order. */
  headings(level: number): string[] {
    return this.elements(`h${level}`).map((element) =>
      textContent(element).replace(/\s+/g, ' ').trim(),
    );
  }

  bodyClasses(): string[] {
    const body = this.elements('body')[0];
    const classes = body ? getAttributeValue(body, 'class') : undefined;
    return classes ? classes.split(/\s+/).filter(Boolean) : [];
  }

  scriptsOfType(type: string): string[] {
    return this.elements('script')
      .filter(
        (element) =>
          (getAttributeValue(element, 'type') ?? '').toLowerCase() === type.toLowerCase(),
      )
      .map((element) => textContent(element));
  }

  /** Text of inline scripts (those without a src), in document order. */
  inlineScripts(): string[] {
    return this.elements('script')
      .filter((element) => getAttributeValue(element, 'src') === undefined)
      .map((element) => textContent(element));
  }

  /** Visible text with scripts, styles and templates removed. */
  text(): string {
    const parts: string[] = [];
    const walk = (nodes: AnyNode[]): void => {
      for (const node of nodes) {
        if (isText(node)) {
          parts.push(node.data);
        } else if (isTag(node)) {
          if (NON_CONTENT_TAGS.has(node.name)) continue;
          walk(node.children);
        }
      }
    };
    walk(this.dom.children);
    return parts.join(' ').replace(/\s+/g, ' ').trim();
  }

  wordCount(): number {
    const text = this.text();
    return text ? text.split(' ').length : 0;
  }

  hasMainLandmark(): boolean {
    return (
      this.elements('main').length > 0 ||
      findAll((element) => getAttributeValue(element, 'role') === 'main', this.dom.children)
        .length > 0
    );
  }

  /** The first main element or role=main landmark in document order, or null. */
  mainLandmark(): Element | null {
    for (const element of preorder(this.dom.children)) {
      if (element.name === 'main' || getAttributeValue(element, 'role') === 'main') return element;
    }
    return null;
  }

  /**
   * The first element inside body (the whole document when there is no body) that
   * matches, in document order. One pre-order walk, O(n).
   */
  firstElement(predicate: (element: Element) => boolean): Element | null {
    const body = this.elements('body')[0];
    for (const element of preorder(body ? body.children : this.dom.children)) {
      if (predicate(element)) return element;
    }
    return null;
  }

  /**
   * True when `first` comes before `second` in document order (pre-order, so an
   * ancestor precedes its descendants). One walk that stops at whichever is met first.
   */
  precedes(first: Element, second: Element): boolean {
    if (first === second) return false;
    for (const element of preorder(this.dom.children)) {
      if (element === first) return true;
      if (element === second) return false;
    }
    return false;
  }

  /** Elements whose attribute matches, e.g. find('div', 'class', /price/). */
  find(tagName: string, attributeName: string, pattern: RegExp): Element[] {
    return this.elements(tagName).filter((element) => {
      const value = getAttributeValue(element, attributeName);
      return value !== undefined && pattern.test(value);
    });
  }

  /**
   * Signals of a WooCommerce variable product: the variations form, an attribute select,
   * or the inlined variation data. Returns the signals found, empty for a simple product.
   */
  variationFormSignals(): string[] {
    const signals: string[] = [];
    if (this.find('form', 'class', /(?:^|\s)variations_form(?:\s|$)/).length > 0)
      signals.push('form.variations_form');
    if (this.find('select', 'name', /^attribute_/).length > 0)
      signals.push('select[name^=attribute_]');
    if (
      findAll(
        (element) => getAttributeValue(element, 'data-product_variations') !== undefined,
        this.dom.children,
      ).length > 0
    )
      signals.push('data-product_variations');
    return signals;
  }

  /**
   * The rendered product image: the img that renders `preferredUrl`, else the first img in
   * the WooCommerce gallery or carrying the wp-post-image class. An img renders the URL
   * when it appears in its src, data-src, srcset or data-srcset, or in a source of the
   * enclosing picture, compared without query parameters and size suffixes (Shopify's
   * `&width=1080`, `_1080x` and `_large`, WordPress's `-300x200`). Among several matches
   * one with alt text wins; one-pixel and aria-hidden helper images are ignored. Null when
   * nothing is found.
   */
  productImage(base: string, preferredUrl: string | null = null): ImageTag | null {
    const images = this.elements('img');
    const toTag = (element: Element): ImageTag => {
      const src = imageCandidates(element, base)[0] ?? '';
      const alt = getAttributeValue(element, 'alt');
      return {
        src,
        alt: alt === undefined ? null : alt.trim(),
        width: pixels(getAttributeValue(element, 'width')),
        height: pixels(getAttributeValue(element, 'height')),
        fullWidth: pixels(getAttributeValue(element, 'data-large_image_width')),
        fullHeight: pixels(getAttributeValue(element, 'data-large_image_height')),
      };
    };
    const wanted = preferredUrl === null ? null : resolveUrl(preferredUrl, base);
    if (wanted !== null) {
      const key = imageKey(wanted);
      const matches = images.filter(
        (element) =>
          !isHelperImage(element) &&
          imageCandidates(element, base).some((candidate) => imageKey(candidate) === key),
      );
      const match =
        matches.find((element) => (getAttributeValue(element, 'alt') ?? '').trim() !== '') ??
        matches[0];
      if (match) return toTag(match);
    }
    const gallery = findAll(
      (element) =>
        /(?:^|\s)woocommerce-product-gallery(?:\s|$)/.test(
          getAttributeValue(element, 'class') ?? '',
        ),
      this.dom.children,
    );
    for (const container of gallery) {
      const first = getElementsByTagName('img', container, true)[0];
      if (first) return toTag(first);
    }
    const featured = this.find('img', 'class', /(?:^|\s)wp-post-image(?:\s|$)/)[0];
    return featured ? toTag(featured) : null;
  }
}

/** The URLs in a srcset: the first token of each comma-separated candidate. */
function srcsetUrls(value: string | undefined): string[] {
  if (!value) return [];
  return value
    .slice(0, 20_000)
    .split(/,\s+|,(?=\s*(?:https?:)?\/\/)/)
    .map((candidate) => candidate.trim().split(/\s+/)[0] ?? '')
    .filter((url) => url !== '');
}

/**
 * Every URL an img may render, resolved against the page: src, data-src, its srcset and
 * data-srcset, and the srcset of each source in an enclosing picture.
 */
function imageCandidates(element: Element, base: string): string[] {
  const raw: string[] = [];
  for (const name of ['src', 'data-src']) {
    const value = getAttributeValue(element, name);
    if (value) raw.push(value);
  }
  raw.push(...srcsetUrls(getAttributeValue(element, 'srcset')));
  raw.push(...srcsetUrls(getAttributeValue(element, 'data-srcset')));
  const parent = element.parent;
  if (parent && isTag(parent) && parent.name === 'picture') {
    for (const source of getElementsByTagName('source', parent, false)) {
      raw.push(...srcsetUrls(getAttributeValue(source, 'srcset')));
      raw.push(...srcsetUrls(getAttributeValue(source, 'data-srcset')));
    }
  }
  const resolved: string[] = [];
  for (const value of raw) {
    const url = resolveUrl(value, base);
    if (url !== null && !resolved.includes(url)) resolved.push(url);
  }
  return resolved;
}

/** A tracking pixel, spacer or decorative duplicate: one pixel wide or high, or aria-hidden. */
function isHelperImage(element: Element): boolean {
  return (
    pixels(getAttributeValue(element, 'width')) === 1 ||
    pixels(getAttributeValue(element, 'height')) === 1 ||
    (getAttributeValue(element, 'aria-hidden') ?? '').trim().toLowerCase() === 'true'
  );
}

/** Shopify (_1080x, _x1080, _1080x1080, _large, _crop_center, @2x) and WordPress (-300x200) size suffixes. */
const SIZE_SUFFIX =
  /(?:_(?:\d{1,5}x\d{0,5}|x\d{1,5}|pico|icon|thumb|small|compact|medium|large|grande|original|master)(?:_crop_[a-z]{1,10})?(?:@[23]x)?|-\d{1,5}x\d{1,5})(?=\.[a-z0-9]{2,5}$)/i;

/**
 * The identity of an image independent of the rendered size: host and path without query
 * parameters (Shopify's `?v=...&width=...`) and without a size suffix in the file name.
 */
function imageKey(url: string): string {
  try {
    const parsed = new URL(url);
    return `${parsed.host.toLowerCase()}${parsed.pathname.replace(SIZE_SUFFIX, '')}`;
  } catch {
    return url;
  }
}

export interface ImageTag {
  /** Resolved against the page URL when relative. */
  src: string;
  /** Null when the attribute is absent; empty when present but blank. */
  alt: string | null;
  width: number | null;
  height: number | null;
  /** WooCommerce's data-large_image_width, the full-size image behind the rendered one. */
  fullWidth: number | null;
  fullHeight: number | null;
}

function pixels(value: string | undefined): number | null {
  if (value === undefined) return null;
  const match = /^\s?(\d{1,6})(?:px)?\s?$/.exec(value);
  const parsed = match ? Number(match[1]) : 0;
  return parsed > 0 ? parsed : null;
}

function resolveUrl(value: string, base: string): string | null {
  try {
    const url = new URL(value, base);
    return url.protocol === 'http:' || url.protocol === 'https:' ? url.href : null;
  } catch {
    return null;
  }
}

/** Elements in document order (pre-order), without recursion so deep trees cannot overflow. */
function* preorder(nodes: AnyNode[]): Generator<Element> {
  const stack = [...nodes].reverse();
  for (let node = stack.pop(); node !== undefined; node = stack.pop()) {
    if (!isTag(node)) continue;
    yield node;
    for (let i = node.children.length - 1; i >= 0; i -= 1) {
      const child = node.children[i];
      if (child) stack.push(child);
    }
  }
}

export function elementText(element: Element): string {
  return textContent(element).replace(/\s+/g, ' ').trim();
}

export function attribute(element: Element, name: string): string | undefined {
  return getAttributeValue(element, name);
}
