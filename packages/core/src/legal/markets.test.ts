import { describe, expect, it } from 'vitest';

import { HtmlDocument } from '../parsers/html.js';
import { detectMarkets, marketOfHostname, parseMarkets } from './markets.js';

describe('market detection', () => {
  it('reads the country-code domain, but not .co on its own', () => {
    expect(marketOfHostname('shop.de')?.market).toBe('EU');
    expect(marketOfHostname('shop.co.uk')?.market).toBe('UK');
    expect(marketOfHostname('loja.com.br')?.market).toBe('BR');
    expect(marketOfHostname('tienda.com.co')?.market).toBe('CO');
    expect(marketOfHostname('brand.co')).toBeNull();
    expect(marketOfHostname('shop.com')).toBeNull();
  });

  it('combines language, hreflang, currency, address and register numbers with evidence', () => {
    const doc = new HtmlDocument(`<html lang="de-CH"><head>
      <link rel="alternate" hreflang="en-GB" href="/en/">
      <script type="application/ld+json">{"@type":"Product","offers":{"@type":"Offer","priceCurrency":"CHF"}}</script>
      <script type="application/ld+json">{"@type":"Organization","address":{"@type":"PostalAddress","addressCountry":"BR"}}</script>
      </head><body>CNPJ 11.222.333/0001-81</body></html>`);
    const markets = detectMarkets('example.com', [doc]);
    const byMarket = Object.fromEntries(markets.map((item) => [item.market, item.evidence]));
    expect(byMarket.CH).toEqual(expect.arrayContaining(['page language de-CH', 'prices in CHF']));
    expect(byMarket.UK).toEqual(['hreflang en-GB']);
    expect(byMarket.BR).toEqual(
      expect.arrayContaining(['country BR in markup', 'br-cnpj 11.222.333/0001-81']),
    );
  });

  it('parses market choices and rejects unknown ones', () => {
    expect(parseMarkets('eu, GB,us')).toEqual(['EU', 'UK', 'US']);
    expect(parseMarkets(['de', 'fr'])).toEqual(['EU']);
    expect(() => parseMarkets('xx')).toThrow(/Unknown market/);
  });
});
