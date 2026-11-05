---
slug: large-catalogs
headline: How to serve a catalog of millions of products to crawlers and agents
description: How a store with millions of products splits its sitemap, pages its API and sizes its feeds so crawlers and agents can read all of it, and what the scanner checks.
keywords: large sitemap, sitemap index, 50000 URLs sitemap limit, paginated product feed, Store API pagination, big catalog SEO, millions of products crawl
related: A1.2, A1.3, A1.7, B1.2, B1.5
---

## In short

No crawler reads 100 million products from one file, and no standard asks a store to serve them that way. Sitemaps split a catalog into files of at most 50,000 URLs and 50 MB, listed in a sitemap index. Store APIs return products page by page. Merchant feeds go to each shopping platform through its own upload, with its own size limits. The scanner checks the sitemap limits it can measure and reads only a sample of a large catalog.

## How sitemaps scale

The Sitemaps protocol limits each sitemap file to 50,000 URLs and 50 MB (52,428,800 bytes) uncompressed. A larger catalog uses a sitemap index: a file that lists sitemap files instead of pages. An index may list up to 50,000 sitemaps. Google accepts up to 500 index files per site in Search Console.

| Products    | Sitemap files of 50,000 URLs | Index files |
| ----------- | ---------------------------- | ----------- |
| 40,000      | 1                            | none needed |
| 1 million   | 20                           | 1           |
| 100 million | 2,000                        | 1           |

A few rules keep a large sitemap useful:

- **Group by type.** Keep products in their own files (`sitemap-products-1.xml`, `sitemap-products-2.xml`) apart from categories and articles. Crawlers, and this scanner, find product files by name.
- **Keep `lastmod` honest.** Set it to the date a product page last changed. A crawler with millions of URLs to choose from uses it to decide what to fetch again.
- **Compress if you like.** Gzip (`.xml.gz`) is allowed and saves bandwidth. The 50 MB limit still counts the uncompressed file.
- **Stay on your own host.** Sitemaps list URLs of the site that serves them.

## How APIs page through a catalog

An API never returns a whole catalog in one response. It returns one page and says how to ask for the next.

- **WooCommerce Store API.** `/wp-json/wc/store/v1/products` takes `page` and `per_page` (at most 100). It answers with `X-WP-Total` (the number of products), `X-WP-TotalPages` and a `Link` header pointing to the next page.
- **Other platforms** page their catalog APIs in the same spirit, with a page number or a cursor (a token that marks where the next page starts).

An agent that wants one product asks the API or fetches the product page. It does not download the catalog. That is why the scanner checks that one page of the API answers, not that the whole catalog downloads.

## How feeds scale

Shopping platforms take product feeds through their own channels. Google Merchant Center fetches a feed file on a schedule from a URL you give it, and the file must be smaller than 4 GB. Larger catalogs split the feed into several files. Other programmes, such as the OpenAI product feed, receive feeds through their own upload process.

A feed you also publish on your site for agents is a convenience, not a requirement. For a very large catalog, link a small number of split files rather than one huge file.

## What the scanner checks

- **Sitemap limits.** The [sitemap check](/knowledge-base/sitemap-declared-and-reachable) warns when a sitemap file it reads declares a `Content-Length` above 50 MB, or when it counts more than 50,000 entries in one file.
- **Product sitemaps first.** The [product URL check](/knowledge-base/product-urls-in-sitemap) reads child sitemaps with product-like names first, so a large index does not hide its products.
- **Freshness.** The [lastmod check](/knowledge-base/sitemap-lastmod) samples `lastmod` dates.
- **One API page.** The [Store API check](/knowledge-base/store-api-reachable) reads one page of the WooCommerce Store API and records `X-WP-Total`.
- **A feed, if you publish one.** The [public feed check](/knowledge-base/public-product-feed) looks for a feed you link from your site.

The scanner reads at most 2 MB of each sitemap file and a few sitemaps in all, then samples a handful of product pages. It never downloads a whole catalog. That keeps scans light for your server, and it is what a careful crawler does too.

## FAQ

### Do I need pagination if my store has only a few thousand products?

No. Up to 50,000 product URLs fit in one sitemap file. A sitemap index costs little, though, and saves work when the catalog grows.

### Why not one big feed file with every product?

A huge file is slow to fetch, easy to cut off and has to be downloaded again in full after every change. Split files let a crawler fetch only the parts that changed, using `lastmod` in the sitemap index.

### Does the scanner count every URL in my sitemap?

No. It reads the first 2 MB of each file and a few files in all, which is enough to judge structure and to sample products. It warns about a file's size only when the server declares it.

## Sources

- [Sitemaps XML format](https://www.sitemaps.org/protocol.html)
- [Google Search Central: manage large sitemaps with a sitemap index](https://developers.google.com/search/docs/crawling-indexing/sitemaps/large-sitemaps)
- [WooCommerce Store API](https://developer.woocommerce.com/docs/apis/store-api/)
- [Google Merchant Center: update your product data source on a schedule](https://support.google.com/merchants/answer/1219255)
