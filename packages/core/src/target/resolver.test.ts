import { describe, expect, it } from 'vitest';

import { HtmlDocument } from '../parsers/html.js';
import { findPolicyLinks } from './resolver.js';

describe('findPolicyLinks', () => {
  it('prefers same-origin links and keeps cross-origin ones as a fallback', () => {
    const doc = new HtmlDocument(`
      <footer>
        <a href="https://parent.example/privacy/">Privacy</a>
        <a href="/returns/">Returns</a>
        <a href="/legal/terms/">Terms</a>
        <a href="/">Home</a>
      </footer>`);
    expect(findPolicyLinks(doc, 'https://shop.example')).toEqual({
      privacy: 'https://parent.example/privacy/',
      returns: 'https://shop.example/returns/',
      terms: 'https://shop.example/legal/terms/',
    });
  });

  it('matches localized link text', () => {
    const doc = new HtmlDocument(
      '<a href="/widerrufsbelehrung/">Widerrufsbelehrung</a><a href="/versand/">Versand</a><a href="/impressum/">Impressum</a>',
    );
    expect(findPolicyLinks(doc, 'https://shop.example')).toEqual({
      returns: 'https://shop.example/widerrufsbelehrung/',
      shipping: 'https://shop.example/versand/',
      imprint: 'https://shop.example/impressum/',
    });
  });
});
