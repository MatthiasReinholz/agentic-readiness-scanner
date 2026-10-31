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
}

const NON_CONTENT_TAGS = new Set(['script', 'style', 'template', 'noscript', 'svg']);

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
      result.push({
        rel: rel.toLowerCase(),
        href,
        ...(type ? { type } : {}),
        ...(hreflang ? { hreflang } : {}),
      });
    }
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

  /** Elements whose attribute matches, e.g. find('div', 'class', /price/). */
  find(tagName: string, attributeName: string, pattern: RegExp): Element[] {
    return this.elements(tagName).filter((element) => {
      const value = getAttributeValue(element, attributeName);
      return value !== undefined && pattern.test(value);
    });
  }
}

export function elementText(element: Element): string {
  return textContent(element).replace(/\s+/g, ' ').trim();
}

export function attribute(element: Element, name: string): string | undefined {
  return getAttributeValue(element, name);
}
