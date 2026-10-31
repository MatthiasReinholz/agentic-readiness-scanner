import { describe, expect, it } from 'vitest';

import { attribute, HtmlDocument } from './html.js';

function must<T>(value: T | null | undefined): T {
  if (value === null || value === undefined) throw new Error('expected a value');
  return value;
}

const PAGE = `<!doctype html>
<html>
<head>
  <title>  Stoneware   Mug </title>
  <meta name="description" content="A mug.">
  <meta property="og:title" content="Mug on Open Graph">
  <meta name="ROBOTS" content="index">
  <link rel="Canonical" href="https://shop.example/product/mug/">
  <link rel="alternate" type="application/json" hreflang="de" href="/de.json">
  <link href="/no-rel.css">
  <script src="https://cdn.example/app.js"></script>
  <script src="//static.example/lib.js"></script>
  <script src="/local.js"></script>
  <script src="http://[bad"></script>
  <script type="application/ld+json">{"@type":"Product"}</script>
  <script type="APPLICATION/LD+JSON">{"@type":"Offer"}</script>
  <style>.hidden{display:none}</style>
</head>
<body class="woocommerce  single-product">
  <a href="/returns/">  Returns
     and refunds </a>
  <a>no href</a>
  <div role="main"><p>Hand-thrown <b>stoneware</b> mug.</p><span class="price-wrap">EUR 24</span></div>
  <img src="https://images.example/mug.jpg">
  <template><p>not visible</p></template>
  <noscript>enable scripts</noscript>
</body>
</html>`;

describe('HtmlDocument', () => {
  const doc = new HtmlDocument(PAGE);

  it('reads the title trimmed and meta by name or property, case-insensitively', () => {
    expect(doc.title()).toBe('Stoneware   Mug');
    expect(doc.meta('description')).toBe('A mug.');
    expect(doc.meta('og:title')).toBe('Mug on Open Graph');
    expect(doc.meta('robots')).toBe('index');
    expect(doc.meta('keywords')).toBeNull();
    expect(new HtmlDocument('<p>no head</p>').title()).toBeNull();
  });

  it('lists link tags with rel lower-cased and optional type and hreflang', () => {
    expect(doc.links()).toEqual([
      { rel: 'canonical', href: 'https://shop.example/product/mug/' },
      { rel: 'alternate', href: '/de.json', type: 'application/json', hreflang: 'de' },
    ]);
  });

  it('lists anchors with href and whitespace-normalised text', () => {
    expect(doc.anchors()).toEqual([{ href: '/returns/', text: 'Returns and refunds' }]);
  });

  it('splits body classes and finds scripts by type', () => {
    expect(doc.bodyClasses()).toEqual(['woocommerce', 'single-product']);
    expect(new HtmlDocument('<body></body>').bodyClasses()).toEqual([]);
    expect(doc.scriptsOfType('application/ld+json')).toEqual([
      '{"@type":"Product"}',
      '{"@type":"Offer"}',
    ]);
  });

  it('extracts visible text without scripts, styles, templates, noscript or svg', () => {
    const text = doc.text();
    expect(text).toContain('Hand-thrown stoneware mug.');
    expect(text).toContain('EUR 24');
    expect(text).not.toContain('display:none');
    expect(text).not.toContain('@type');
    expect(text).not.toContain('not visible');
    expect(text).not.toContain('enable scripts');
    expect(doc.wordCount()).toBe(text.split(' ').length);
    expect(new HtmlDocument('').wordCount()).toBe(0);
  });

  it('detects a main landmark by element or role', () => {
    expect(doc.hasMainLandmark()).toBe(true);
    expect(new HtmlDocument('<body><main></main></body>').hasMainLandmark()).toBe(true);
    expect(new HtmlDocument('<body><div></div></body>').hasMainLandmark()).toBe(false);
  });

  it('finds the first main landmark, the first matching element and document order', () => {
    const page = new HtmlDocument(
      '<body><div id="consent"><p>cookies</p></div><main id="first"></main><div role="main" id="second"></div></body>',
    );
    const main = must(page.mainLandmark());
    expect(attribute(main, 'id')).toBe('first');
    const consent = must(page.firstElement((element) => attribute(element, 'id') === 'consent'));
    expect(consent.name).toBe('div');
    expect(page.firstElement((element) => element.name === 'nav')).toBeNull();
    expect(page.precedes(consent, main)).toBe(true);
    expect(page.precedes(main, consent)).toBe(false);
    expect(page.precedes(main, main)).toBe(false);
    // Pre-order: a wrapper precedes the landmark it contains.
    const wrapped = new HtmlDocument('<body><div class="modal"><main></main></div></body>');
    const wrapper = must(wrapped.firstElement((element) => element.name === 'div'));
    expect(wrapped.precedes(wrapper, must(wrapped.mainLandmark()))).toBe(true);
    // Without a body the whole document is searched.
    expect(must(new HtmlDocument('<div role="main"></div>').mainLandmark()).name).toBe('div');
    expect(new HtmlDocument('<p>no landmark</p>').mainLandmark()).toBeNull();
    expect(new HtmlDocument('<p>no body</p>').firstElement((e) => e.name === 'p')?.name).toBe('p');
  });

  it('finds elements by attribute pattern', () => {
    expect(doc.find('span', 'class', /\bprice/)).toHaveLength(1);
    expect(doc.find('span', 'class', /\bprice$/)).toHaveLength(0);
    expect(doc.find('*', 'role', /main/)).toHaveLength(1);
  });

  it('collects asset hosts including protocol-relative URLs and skips invalid ones', () => {
    const hosts = doc.assetHosts('https://shop.example/');
    expect([...hosts].sort()).toEqual([
      'cdn.example',
      'images.example',
      'shop.example',
      'static.example',
    ]);
  });
});
