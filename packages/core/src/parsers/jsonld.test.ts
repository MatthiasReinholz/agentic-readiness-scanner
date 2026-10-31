import { describe, expect, it } from 'vitest';

import { HtmlDocument } from './html.js';
import {
  asString,
  extractJsonLd,
  gtinOf,
  hasType,
  offersOf,
  productNodes,
  variantNodes,
} from './jsonld.js';

function docWith(...scripts: string[]): HtmlDocument {
  return new HtmlDocument(
    `<html><head>${scripts.map((s) => `<script type="application/ld+json">${s}</script>`).join('')}</head></html>`,
  );
}

describe('extractJsonLd', () => {
  it('flattens arrays and nested @graph blocks into one node list', () => {
    const { nodes, errors } = extractJsonLd(
      docWith(
        JSON.stringify({
          '@context': 'https://schema.org',
          '@graph': [
            { '@type': 'WebSite', name: 'Shop' },
            { '@graph': [{ '@type': 'Product', name: 'Mug' }] },
          ],
        }),
        JSON.stringify([{ '@type': 'Organization' }, [{ '@type': 'BreadcrumbList' }]]),
      ),
    );
    expect(errors).toEqual([]);
    expect(nodes.map((node) => node['@type'])).toEqual([
      'WebSite',
      'Product',
      'Organization',
      'BreadcrumbList',
    ]);
  });

  it('ignores invalid JSON and non-object values but records the parse error', () => {
    const { nodes, errors } = extractJsonLd(
      docWith('{"@type": "Product",', '"just a string"', '42', 'null', '{"@type":"Offer"}'),
    );
    expect(nodes).toEqual([{ '@type': 'Offer' }]);
    expect(errors).toHaveLength(1);
  });

  it('returns nothing for a page without JSON-LD', () => {
    expect(extractJsonLd(new HtmlDocument('<p>plain</p>'))).toEqual({ nodes: [], errors: [] });
  });
});

describe('productNodes and hasType', () => {
  it('matches Product and ProductGroup by string, array or schema.org-prefixed type', () => {
    const nodes = [
      { '@type': 'Product' },
      { '@type': ['Thing', 'ProductGroup'] },
      { '@type': 'https://schema.org/Product' },
      { '@type': 'product' },
      { '@type': 'Offer' },
      { name: 'untyped' },
    ];
    expect(productNodes(nodes)).toHaveLength(4);
    expect(hasType({ '@type': ['Offer', 'AggregateOffer'] }, 'AggregateOffer')).toBe(true);
    expect(hasType({ '@type': 7 }, 'Product')).toBe(false);
  });
});

describe('offersOf', () => {
  it('accepts one offer, an array, an AggregateOffer, and drops anything else', () => {
    expect(offersOf({ offers: { '@type': 'Offer', price: '1' } })).toHaveLength(1);
    expect(
      offersOf({
        offers: [
          { '@type': 'Offer' },
          { '@type': 'AggregateOffer' },
          { '@type': 'Demand' },
          'not an object',
        ],
      }),
    ).toHaveLength(2);
    expect(offersOf({})).toEqual([]);
    expect(offersOf({ offers: 'string' })).toEqual([]);
  });
});

describe('variantNodes', () => {
  it('lists the Product nodes under hasVariant and nothing else', () => {
    expect(
      variantNodes({
        '@type': 'ProductGroup',
        hasVariant: [
          { '@type': 'Product', name: 'Small' },
          { '@type': 'Offer', price: '1' },
          { '@type': 'https://schema.org/Product', name: 'Large' },
        ],
      }).map((node) => node.name),
    ).toEqual(['Small', 'Large']);
    expect(
      variantNodes({ '@type': 'ProductGroup', hasVariant: { '@type': 'Product' } }),
    ).toHaveLength(1);
    expect(variantNodes({ '@type': 'Product' })).toEqual([]);
    expect(variantNodes({ hasVariant: 'string' })).toEqual([]);
  });
});

describe('asString and gtinOf', () => {
  it('normalises strings and numbers and rejects everything else', () => {
    expect(asString('  24.00 ')).toBe('24.00');
    expect(asString('   ')).toBeNull();
    expect(asString(24)).toBe('24');
    expect(asString(null)).toBeNull();
    expect(asString({ '@value': '1' })).toBeNull();
    expect(asString(true)).toBeNull();
  });

  it('reads the first GTIN field present, numeric or string', () => {
    expect(gtinOf({ gtin13: '4006381333931' })).toBe('4006381333931');
    expect(gtinOf({ gtin: '', gtin12: 12345678905 })).toBe('12345678905');
    expect(gtinOf({ gtin8: '96385074', gtin14: '1' })).toBe('96385074');
    expect(gtinOf({ sku: 'MUG' })).toBeNull();
  });
});
