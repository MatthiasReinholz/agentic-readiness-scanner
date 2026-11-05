---
slug: crawl-services
headline: How crawl services like Cloudflare's /crawl read your store
description: What crawl APIs such as Cloudflare's /crawl and Firecrawl read on a store, why there is no /crawl endpoint for a website to publish, and how to be easy to crawl.
keywords: Cloudflare crawl endpoint, CloudflareBrowserRenderingCrawler, Firecrawl crawl, crawl API AI agents, make store crawlable, crawl endpoint standard
related: A1.1, A1.2, A1.3, A2.3, A2.5, A3.2, A3.6
---

## In short

Crawl services such as Cloudflare's /crawl endpoint and Firecrawl let a developer or an agent read a whole website with one request. They run on the service's side, so there is nothing for a store to install or publish. What they read is your robots.txt, your sitemap, your links and the HTML your server sends, which are exactly the things this scanner checks.

## What a crawl service is

A crawl service is an API (an interface other programs call) that takes a start URL and returns the content of many pages from that site, often as Markdown or JSON. Developers use them to load a store's catalog into an assistant or a search index. Agents use them to read a site before they answer a question about it.

Two well-documented examples:

- **Cloudflare's /crawl endpoint**, part of Browser Run. The caller sends a start URL, and Cloudflare crawls the site and returns the pages. Its crawler identifies itself as `CloudflareBrowserRenderingCrawler`, a name the caller cannot change.
- **Firecrawl's crawl endpoint.** It starts from a URL, combines the sitemap with the links it finds, and returns each page's content.

Both discover pages the same way a search crawler does: the sitemap first, then the links on each page. Both respect robots.txt by default.

## Is there a /crawl standard for websites?

No. The path `/crawl` belongs to these services' own APIs, on their own hosts. No standard asks a website to publish a crawl endpoint, and this scanner does not test for one. Recommending one would send you to build something no crawler asks for.

What crawl services do follow are the open standards a site already publishes:

| What they read                    | Standard                      | Checked by                                                                                                                         |
| --------------------------------- | ----------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| What they may fetch               | robots.txt (RFC 9309)         | [robots.txt](/knowledge-base/robots-txt-exists-and-parses), [on-request fetchers](/knowledge-base/user-triggered-fetchers-allowed) |
| Which pages exist                 | Sitemaps protocol             | [sitemap](/knowledge-base/sitemap-declared-and-reachable), [product URLs in sitemap](/knowledge-base/product-urls-in-sitemap)      |
| What they may use the content for | Content Signals in robots.txt | [usage-preference signals](/knowledge-base/usage-preference-signals)                                                               |
| The page content                  | Server-rendered HTML          | [server-rendered product content](/knowledge-base/server-rendered-product-content)                                                 |
| Which URLs are real               | HTTP status codes             | [unknown URLs answer 404](/knowledge-base/unknown-urls-answer-404)                                                                 |

Cloudflare documents two more behaviours. Its crawler honours `Crawl-delay` in robots.txt and waits half a second between requests when there is none. It also rejects a crawl when the caller declares a purpose, such as AI training, that your Content-Signal line sets to `no`. The caller's declaration is trusted, not verified.

## How to make your store easy to crawl

1. **Allow the crawler.** Do not disallow `CloudflareBrowserRenderingCrawler` on product and policy paths unless you mean to. A Disallow is a real block for it. A long `Crawl-delay` slows every crawl of a large catalog.
2. **Publish a complete sitemap.** Declare it in robots.txt, list your product pages, and split a large catalog with a sitemap index. The guide [How to serve a catalog of millions of products](/knowledge-base/guides/large-catalogs) explains how.
3. **Render pages on the server.** Crawl services can run a browser, but many callers ask for the plain HTML because it is faster and cheaper. A page that is empty until JavaScript runs gives them nothing.
4. **Answer 404 for pages that do not exist.** A site that answers every URL with the same page and status 200 makes a crawler store thousands of copies of nothing.
5. **Say what the content may be used for.** If you have a position on AI training or AI answers, state it in robots.txt groups and, if you like, in a Content-Signal line.

## What the scanner does not check

The scanner does not call Cloudflare or Firecrawl, and it does not test whether bot protection lets their crawlers through. Cloudflare's crawler does not bypass CAPTCHAs or bot protection. If your firewall blocks unverified clients, it blocks this crawler too, and you allow it there, not in robots.txt. The scanner's own [honest-fetch check](/knowledge-base/no-block-on-honest-fetch) shows what an identified client without special access meets.

## FAQ

### Should I build a /crawl endpoint on my site?

No. No crawler or agent asks a website for one. Spend the effort on a complete sitemap and server-rendered pages, which every crawler uses.

### Does Cloudflare's /crawl obey robots.txt?

Yes. Cloudflare documents that it respects robots.txt, including `Crawl-delay`, and reports a disallowed URL as skipped instead of fetching it.

### Can I block crawl services?

Yes. Add a robots.txt group for `CloudflareBrowserRenderingCrawler` with the paths you want to keep out. Firecrawl respects robots.txt by default too. Firewall rules work for clients that ignore robots.txt.

### Does a crawl service run JavaScript?

It can. Cloudflare's crawler runs in a browser, but the caller can ask for plain HTML instead. Plenty of callers do, so content that only appears after scripts run is often missed.

## Sources

- [Cloudflare Browser Run: /crawl endpoint](https://developers.cloudflare.com/browser-rendering/rest-api/crawl-endpoint/)
- [Firecrawl: crawl](https://docs.firecrawl.dev/features/crawl)
- [RFC 9309: Robots Exclusion Protocol](https://www.rfc-editor.org/rfc/rfc9309)
- [Sitemaps XML format](https://www.sitemaps.org/protocol.html)
- [Content Signals Policy](https://contentsignals.org/)
