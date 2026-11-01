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
    expect(doc.anchors()).toEqual([
      { href: '/returns/', text: 'Returns and refunds', inFooter: false },
    ]);
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

  it('lists the WooCommerce variation form signals present', () => {
    expect(doc.variationFormSignals()).toEqual([]);
    expect(
      new HtmlDocument(
        '<form class="variations_form cart"><select name="attribute_pa_size"></select></form><div data-product_variations="[]"></div>',
      ).variationFormSignals(),
    ).toEqual(['form.variations_form', 'select[name^=attribute_]', 'data-product_variations']);
    expect(
      new HtmlDocument('<form class="my_variations_form"></form>').variationFormSignals(),
    ).toEqual([]);
  });

  it('finds the rendered product image by src, gallery or featured class', () => {
    const base = 'https://shop.example/product/mug/';
    const page = new HtmlDocument(`
      <img src="/logo.png" alt="Logo">
      <div class="woocommerce-product-gallery">
        <img width="600" height="600" data-large_image_width="1200" src="/wp-content/uploads/mug.jpg" alt=" Blue mug ">
      </div>
      <img class="attachment-thumb wp-post-image" data-src="https://cdn.example/lazy.jpg">
    `);
    expect(page.productImage(base, 'https://shop.example/wp-content/uploads/mug.jpg')).toEqual({
      src: 'https://shop.example/wp-content/uploads/mug.jpg',
      alt: 'Blue mug',
      width: 600,
      height: 600,
      fullWidth: 1200,
      fullHeight: null,
    });
    expect(page.productImage(base, 'https://cdn.example/elsewhere.jpg')?.alt).toBe('Blue mug');
    expect(page.productImage(base)?.src).toBe('https://shop.example/wp-content/uploads/mug.jpg');
    const featured = new HtmlDocument(
      '<img class="wp-post-image" data-src="https://cdn.example/lazy.jpg" width="abc">',
    ).productImage(base);
    expect(featured).toEqual({
      src: 'https://cdn.example/lazy.jpg',
      alt: null,
      width: null,
      height: null,
      fullWidth: null,
      fullHeight: null,
    });
    expect(doc.productImage(base)).toBeNull();
  });

  it('reads the root lang, external scripts, stylesheets and headings', () => {
    const doc = new HtmlDocument(`<!doctype html><html lang=" de-DE "><head>
      <link rel="preload stylesheet" href="/theme.css"><link rel="icon" href="/favicon.ico">
      <script src="/app.js"></script><script src=""></script><script>inline()</script>
      </head><body><h1> Stoneware <em>Mug</em> </h1><h2>Details</h2><h1>Second</h1></body></html>`);
    expect(doc.lang()).toBe('de-DE');
    expect(doc.externalScripts()).toEqual(['/app.js']);
    expect(doc.stylesheets()).toEqual(['/theme.css']);
    expect(doc.headings(1)).toEqual(['Stoneware Mug', 'Second']);
    expect(doc.headings(2)).toEqual(['Details']);
    expect(new HtmlDocument('<html><body></body></html>').lang()).toBeNull();
    expect(new HtmlDocument('<html lang=""><body></body></html>').lang()).toBeNull();
  });

  it('returns the text of inline scripts only', () => {
    const page = new HtmlDocument(`
      <script src="/app.js">ignored</script>
      <script>navigator.modelContext.registerTool({ name: 'search' });</script>
      <script type="application/ld+json">{"@type":"Thing"}</script>
    `);
    expect(page.inlineScripts()).toEqual([
      "navigator.modelContext.registerTool({ name: 'search' });",
      '{"@type":"Thing"}',
    ]);
    expect(new HtmlDocument('<p>no scripts</p>').inlineScripts()).toEqual([]);
  });
});

describe('HtmlDocument controls and link titles', () => {
  it('keeps a link title and lists buttons and inputs as controls', () => {
    const page = new HtmlDocument(`<head>
      <link rel="alternate" type="application/rss+xml" title="Shop » Feed" href="/feed/">
    </head><body>
      <form class="cart">
        <input type="hidden" name="add-to-cart" value="12">
        <button type="submit" class="single_add_to_cart_button button" id="buy">
          Add <span>to cart</span>
        </button>
      </form>
      <input type="submit" value="Buy now">
    </body>`);
    expect(page.links()).toEqual([
      { rel: 'alternate', href: '/feed/', type: 'application/rss+xml', title: 'Shop » Feed' },
    ]);
    expect(page.controls()).toEqual([
      {
        tag: 'button',
        type: 'submit',
        id: 'buy',
        className: 'single_add_to_cart_button button',
        text: 'Add to cart',
      },
      { tag: 'input', type: 'hidden', name: 'add-to-cart', value: '12', text: '' },
      { tag: 'input', type: 'submit', value: 'Buy now', text: '' },
    ]);
    expect(new HtmlDocument('<p>none</p>').controls()).toEqual([]);
  });
});

describe('HtmlDocument.productImage on Shopify-style markup', () => {
  const base = 'https://shop.example/products/leggings';
  const cdn = 'https://cdn.shopify.com/s/files/1/0001/products/leggings.jpg';

  it('matches the image rendered at another size through width parameters and srcset', () => {
    const page = new HtmlDocument(`
      <img src="${cdn}?v=1&width=1080" alt="Leggings" width="1080" height="1350"
           srcset="${cdn}?v=1&width=352 352w, ${cdn}?v=1&width=1080 1080w">`);
    expect(page.productImage(base, `${cdn}?v=1`)?.alt).toBe('Leggings');
    const lazy = new HtmlDocument(
      `<img data-srcset="//cdn.shopify.com/s/files/1/0001/products/leggings_{width}x.jpg?v=1 1x, ${cdn}?v=1&width=600 600w" alt="Lazy">`,
    );
    expect(lazy.productImage(base, `${cdn}?v=1`)?.alt).toBe('Lazy');
  });

  it('matches size suffixes in the file name and sources of an enclosing picture', () => {
    const page = new HtmlDocument(`
      <picture>
        <source media="(min-width: 750px)" srcset="//cdn.shopify.com/s/files/1/0001/products/leggings_1080x.jpg 1x, //cdn.shopify.com/s/files/1/0001/products/leggings_1080x@2x.jpg 2x">
        <img src="//cdn.shopify.com/s/files/1/0001/products/leggings_600x600_crop_center.jpg" alt="In picture">
      </picture>
      <img src="/wp-content/uploads/mug-300x200.jpg" alt="WordPress thumb">`);
    expect(page.productImage(base, cdn)?.alt).toBe('In picture');
    expect(page.productImage(base, 'https://shop.example/wp-content/uploads/mug.jpg')?.alt).toBe(
      'WordPress thumb',
    );
    expect(page.productImage(base, 'https://cdn.example/other.jpg')).toBeNull();
  });

  it('prefers a match with alt text and ignores one-pixel and aria-hidden helpers', () => {
    const page = new HtmlDocument(`
      <img src="${cdn}" width="1" height="1" alt="Pixel">
      <img src="${cdn}" aria-hidden="true" alt="Hidden slide">
      <img src="${cdn}" alt="">
      <img src="${cdn}" alt="Real">`);
    expect(page.productImage(base, cdn)?.alt).toBe('Real');
    const onlyEmpty = new HtmlDocument(`<img src="${cdn}" alt=""><img src="${cdn}">`);
    expect(onlyEmpty.productImage(base, cdn)?.alt).toBe('');
    const onlyHelpers = new HtmlDocument(`<img src="${cdn}" width="1" height="1" alt="Pixel">`);
    expect(onlyHelpers.productImage(base, cdn)).toBeNull();
  });
});
