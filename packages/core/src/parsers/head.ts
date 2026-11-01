/**
 * Position-aware scan of a document's head. Google reads the head only up to the first
 * element that does not belong there and ignores metadata after it; browsers close the
 * head early in the same situation. The DOM parser hides that, so this scan tokenizes the
 * raw HTML and records where each piece of metadata sits relative to that boundary.
 */
import { Parser } from 'htmlparser2';

/** Elements that may appear in a head without ending it (Google's list plus noscript/template). */
const HEAD_ELEMENTS = new Set([
  'title',
  'meta',
  'link',
  'script',
  'style',
  'base',
  'noscript',
  'template',
]);

export type MetadataKind = 'title' | 'canonical' | 'robots' | 'description' | 'hreflang';

export interface MisplacedMetadata {
  kind: MetadataKind;
  /** Byte offset of the element's start tag in the document. */
  offset: number;
  /** 'after_invalid' when a non-head element preceded it inside the head; 'body' otherwise. */
  where: 'after_invalid' | 'body';
}

export interface HeadScan {
  doctype: 'html' | 'other' | 'none';
  /** Offset of the first `<meta charset>` or `http-equiv=content-type` with a charset, or null. */
  charsetOffset: number | null;
  /** The first element inside the head that does not belong there, with its offset. */
  invalidHeadElement: { tag: string; offset: number } | null;
  misplaced: MisplacedMetadata[];
  /** Seconds of the first `<meta http-equiv="refresh">` with a URL, or null. */
  metaRefreshSeconds: number | null;
  metaRefreshUrl: string | null;
}

function refreshContent(content: string): { seconds: number; url: string } | null {
  const match = /^\s*(\d+(?:\.\d+)?)\s*(?:[;,]\s*(?:url\s*=\s*)?['"]?([^'"\s]+))?/i.exec(content);
  if (!match || !match[1]) return null;
  const seconds = Number(match[1]);
  if (!Number.isFinite(seconds)) return null;
  return { seconds, url: match[2] ?? '' };
}

export function scanHead(html: string): HeadScan {
  const result: HeadScan = {
    doctype: 'none',
    charsetOffset: null,
    invalidHeadElement: null,
    misplaced: [],
    metaRefreshSeconds: null,
    metaRefreshUrl: null,
  };
  let region: 'before' | 'head' | 'body' = 'before';
  // With scripting on, noscript content in the head is text to a browser and to Google's
  // renderer, so elements inside it neither end the head nor count as metadata.
  let noscriptDepth = 0;
  const parser = new Parser(
    {
      onclosetag(name) {
        if (name === 'noscript' && noscriptDepth > 0) noscriptDepth -= 1;
      },
      onprocessinginstruction(name, data) {
        if (name.toLowerCase() === '!doctype' && result.doctype === 'none') {
          result.doctype = /^!doctype\s+html\s*>?$/i.test(data.trim()) ? 'html' : 'other';
        }
      },
      onopentag(name, attributes) {
        const offset = parser.startIndex;
        const attr = (key: string): string | undefined => {
          for (const [k, v] of Object.entries(attributes)) if (k.toLowerCase() === key) return v;
          return undefined;
        };
        if (name === 'noscript') {
          noscriptDepth += 1;
          return;
        }
        if (noscriptDepth > 0) return;
        if (name === 'html') return;
        if (name === 'head') {
          if (region === 'before') region = 'head';
          return;
        }
        if (name === 'body') {
          region = 'body';
          return;
        }
        if (region === 'before') region = 'head'; // implicit head
        if (region === 'head' && !HEAD_ELEMENTS.has(name) && result.invalidHeadElement === null) {
          result.invalidHeadElement = { tag: name, offset };
        }
        const where: MisplacedMetadata['where'] | null =
          region === 'body' ? 'body' : result.invalidHeadElement !== null ? 'after_invalid' : null;
        let kind: MetadataKind | null = null;
        if (name === 'title') kind = 'title';
        else if (name === 'link') {
          const rel = (attr('rel') ?? '').toLowerCase().split(/\s+/);
          if (rel.includes('canonical')) kind = 'canonical';
          else if (rel.includes('alternate') && attr('hreflang')) kind = 'hreflang';
        } else if (name === 'meta') {
          const metaName = (attr('name') ?? '').toLowerCase();
          const equiv = (attr('http-equiv') ?? '').toLowerCase();
          const content = attr('content') ?? '';
          if (metaName === 'robots' || metaName === 'googlebot' || metaName === 'bingbot')
            kind = 'robots';
          else if (metaName === 'description') kind = 'description';
          if (attr('charset') !== undefined && result.charsetOffset === null) {
            result.charsetOffset = offset;
          } else if (
            equiv === 'content-type' &&
            /charset=/i.test(content) &&
            result.charsetOffset === null
          ) {
            result.charsetOffset = offset;
          }
          if (equiv === 'refresh' && result.metaRefreshSeconds === null) {
            const refresh = refreshContent(content);
            if (refresh && refresh.url) {
              result.metaRefreshSeconds = refresh.seconds;
              result.metaRefreshUrl = refresh.url;
            }
          }
        }
        if (kind !== null && where !== null) result.misplaced.push({ kind, offset, where });
      },
    },
    { lowerCaseTags: true, lowerCaseAttributeNames: true, recognizeSelfClosing: true },
  );
  parser.write(html);
  parser.end();
  return result;
}
