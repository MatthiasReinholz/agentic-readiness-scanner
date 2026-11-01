/**
 * Thin HTML helpers over htmlparser2. Checks never parse HTML themselves.
 */
import { isTag, isText, type AnyNode, type Document, type Element } from 'domhandler';
import { findAll, getAttributeValue, getElementsByTagName, textContent } from 'domutils';
import { parseDocument } from 'htmlparser2';

export interface Anchor {
  href: string;
  text: string;
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
      result.push({ href, text: textContent(element).replace(/\s+/g, ' ').trim() });
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
    return lang ? lang : null;
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
   * The rendered product image: the img whose src resolves to `preferredUrl`, else the
   * first img in the WooCommerce gallery or carrying the wp-post-image class. Lazy-loaded
   * images are read from data-src when src is absent. Null when neither is found.
   */
  productImage(base: string, preferredUrl: string | null = null): ImageTag | null {
    const images = this.elements('img');
    const toTag = (element: Element): ImageTag => {
      const src = getAttributeValue(element, 'src') ?? getAttributeValue(element, 'data-src') ?? '';
      const alt = getAttributeValue(element, 'alt');
      return {
        src: resolveUrl(src, base) ?? src,
        alt: alt === undefined ? null : alt.trim(),
        width: pixels(getAttributeValue(element, 'width')),
        height: pixels(getAttributeValue(element, 'height')),
        fullWidth: pixels(getAttributeValue(element, 'data-large_image_width')),
        fullHeight: pixels(getAttributeValue(element, 'data-large_image_height')),
      };
    };
    const wanted = preferredUrl === null ? null : resolveUrl(preferredUrl, base);
    if (wanted !== null) {
      const match = images.map(toTag).find((tag) => tag.src === wanted);
      if (match) return match;
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
