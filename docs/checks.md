# Check catalog

<!-- Generated from packages/catalog by `pnpm docs:generate`. Edit the data files, not this file. -->

Catalog version **0.1.2**, scoring version **0.1.0**.

55 checks in 9 groups. Each check answers one question, records the evidence that decided it, and ships with a fix. Weight 1 is nice to have, 2 is expected, 3 is blocking for agents; "info" checks are reported but never scored. Checks marked WC run only when WooCommerce is detected.

## Levels

| Level | Name | Gate |
| --- | --- | --- |
| 0 | Not reachable | robots.txt blocks shopping agents or product pages are not server-rendered. |
| 1 | Crawlable | A1.1, A2.2, A3.2 |
| 2 | Readable catalog | A1.1, A2.2, A3.2, B1.2 or B1.5, B2.1, B2.2 |
| 3 | Identifiable products | A1.1, A2.2, A3.2, B1.2 or B1.5, B2.1, B2.2, B3.1, B3.2, B3.6 |
| 4 | Trusted merchant | A1.1, A2.2, A3.2, B1.2 or B1.5, B2.1, B2.2, B3.1, B3.2, B3.6, B4.1, B4.2, B4.3 |
| 5 | Transactable | A1.1, A2.2, A3.2, B1.2 or B1.5, B2.1, B2.2, B3.1, B3.2, B3.6, B4.1, B4.2, B4.3, B5.1 or B5.3 |

## Profiles

| Profile | Applies | Drops | Max level |
| --- | --- | --- | --- |
| WooCommerce store | all 55 | nothing | 5 |
| Other store | 50 | B1.2, B1.3, B1.4, B1.7, B5.7 | 5 |
| Content site | 22 | 33 checks (all commerce groups) | 1 |

## A1. Discoverability (ingestion)

Can an agent find the site, its sitemap, its product URLs and its agent-facing index files?

| ID | Check | How it is tested | Weight | Depends on | Spec |
| --- | --- | --- | --- | --- | --- |
| A1.1 | robots.txt exists and parses | GET /robots.txt. Pass on a 200 text response that parses under RFC 9309; warn on 404 (everything allowed by default, but intent is unstated); fail on 5xx, a challenge page or unparseable content. | 3 | – | [RFC 9309 Robots Exclusion Protocol](https://www.rfc-editor.org/rfc/rfc9309) |
| A1.2 | Sitemap declared and reachable | Collect Sitemap: lines from robots.txt, then try /sitemap.xml, /sitemap_index.xml and /wp-sitemap.xml. Pass when one returns parseable XML with at least one URL or child sitemap. | 2 | – | [Sitemaps XML format](https://www.sitemaps.org/protocol.html) |
| A1.3 | Product URLs in sitemap | Pass when the sitemap index contains a product sitemap (WooCommerce: product-sitemap.xml or wp-sitemap-posts-product-*.xml) or the URL set contains URLs matching product path patterns. | 2 | A1.2 | [Sitemaps XML format](https://www.sitemaps.org/protocol.html) |
| A1.4 | Link response headers | Read the Link header on the homepage response. Pass when it carries rel="alternate" type="text/markdown", rel="api-catalog", rel="llms-txt" or an MCP relation; warn when only unrelated links exist; fail when absent. | 1 | – | [RFC 8288 Web Linking](https://www.rfc-editor.org/rfc/rfc8288) |
| A1.5 | llms.txt present and well-formed | GET /llms.txt. Pass on a Markdown document with an H1, an optional blockquote summary and at least one link section, per llmstxt.org; warn when present but malformed. | 2 | – | [llms.txt proposal](https://llmstxt.org/) |
| A1.6 | llms.txt links to catalog | Pass when at least one link in llms.txt targets a product feed, the Store API, a sitemap of products or a product index page. | 2 | A1.5 | [llms.txt proposal](https://llmstxt.org/) |

## A2. Bot access control (ingestion)

Do robots.txt, response headers and the WAF let shopping agents in, and are AI-training rules explicit rather than accidental?

| ID | Check | How it is tested | Weight | Depends on | Spec |
| --- | --- | --- | --- | --- | --- |
| A2.1 | AI crawler rules are explicit | For GPTBot, ClaudeBot, Google-Extended, PerplexityBot, CCBot, Bytespider and Applebot-Extended, record whether robots.txt names the agent. Pass when all are named (allowed or disallowed); warn when some are; fail when none are. The verdict is per bot in the evidence. | 2 | A1.1 | [RFC 9309 Robots Exclusion Protocol](https://www.rfc-editor.org/rfc/rfc9309), [OpenAI crawler documentation](https://developers.openai.com/api/docs/bots), [Google common crawlers](https://developers.google.com/crawling/docs/crawlers-fetchers/google-common-crawlers) |
| A2.2 | Shopping agents are not blocked | Evaluate robots.txt for ChatGPT-User, Claude-User, OAI-SearchBot, Google-Agent and Perplexity-User against a sampled product path. Fail when any is disallowed; pass otherwise. | 3 | A1.1 | [RFC 9309 Robots Exclusion Protocol](https://www.rfc-editor.org/rfc/rfc9309), [OpenAI crawler documentation](https://developers.openai.com/api/docs/bots) |
| A2.3 | Content Signals declared | Look for Content-Signal: lines in robots.txt or a Content-Signal response header with ai-train, search or ai-input values. Pass when present and parseable. | 1 | – | [Content Signals](https://contentsignals.org/) |
| A2.4 | No WAF challenge for agent profiles | Fetch one product page with a browser baseline and up to six agent user-agent strings. Compare status code and extracted main text. Fail on a challenge page, 403 or cloaked content for any agent profile; warn on minor differences. | 3 | – | [RFC 9110 HTTP Semantics (User-Agent)](https://www.rfc-editor.org/rfc/rfc9110) |
| A2.5 | Web Bot Auth key directory | GET /.well-known/http-message-signatures-directory. Informational: pass when a JWKS-shaped document is served, otherwise warn without penalty beyond weight 1. | 1 | – | [Web Bot Auth architecture (IETF draft)](https://datatracker.ietf.org/doc/draft-meunier-web-bot-auth-architecture/) |
| A2.6 | No noindex or nosnippet on product pages | Read X-Robots-Tag headers and meta robots tags on sampled product pages. Fail on noindex; warn on nosnippet, noai or max-snippet:0. | 2 | – | [Robots meta tag and X-Robots-Tag](https://developers.google.com/search/docs/crawling-indexing/robots-meta-tag) |

## A3. Content accessibility (ingestion)

Can an agent read product content without executing JavaScript, and can it ask for Markdown instead of HTML?

| ID | Check | How it is tested | Weight | Depends on | Spec |
| --- | --- | --- | --- | --- | --- |
| A3.1 | Markdown content negotiation | GET a sampled product page with Accept: text/markdown. Pass when the response is text/markdown with the product title in the body; fail when HTML comes back. | 2 | – | [RFC 7763 text/markdown media type](https://www.rfc-editor.org/rfc/rfc7763) |
| A3.2 | Server-rendered product content | Parse the raw HTML of sampled product pages. Pass when a title, a price-like value and a description are present as text or structured data; fail when the body is an empty app shell. | 3 | – | [Google: JavaScript SEO basics](https://developers.google.com/search/docs/crawling-indexing/javascript/javascript-seo-basics) |
| A3.3 | Page weight and response time | Measure HTML size and time to first byte on sampled product pages. Pass under 500 KB and 1.5 s; warn under 1 MB and 3 s; fail above. | 1 | – | [web.dev: Time to First Byte](https://web.dev/articles/ttfb) |
| A3.4 | Canonical and hreflang present | Pass when sampled product pages carry a rel=canonical that resolves to the same origin; warn when hreflang alternates exist for some but not all detected languages. | 1 | – | [Google: canonical URLs](https://developers.google.com/search/docs/crawling-indexing/consolidate-duplicate-urls), [Google: localized versions](https://developers.google.com/search/docs/specialty/international/localized-versions) |
| A3.5 | Accessible main content | Pass when a main or article landmark wraps the product content; warn when a consent overlay appears to wrap or precede it in the DOM. | 1 | – | [WAI-ARIA 1.2: landmark roles](https://www.w3.org/TR/wai-aria-1.2/#landmark_roles) |

## A4. Protocol discovery (ingestion)

Does the site publish machine-readable discovery documents (MCP, API catalog, OAuth, Agent Skills, A2A)? Low weight: expected to be absent on most stores today.

| ID | Check | How it is tested | Weight | Depends on | Spec |
| --- | --- | --- | --- | --- | --- |
| A4.1 | MCP server card | GET /.well-known/mcp/server-card.json. Pass on valid JSON with a name and an endpoint. The path is a community convention this scanner adopts, not part of the MCP specification: the Server Card extension (SEP-2127) recommends publishing the card at <endpoint>/server-card and listing it in /.well-known/ai-catalog.json. | 1 | – | [Model Context Protocol specification](https://modelcontextprotocol.io/specification/latest), [SEP-2127: MCP Server Cards](https://modelcontextprotocol.io/seps/2127-mcp-server-cards) |
| A4.2 | API catalog | GET /.well-known/api-catalog. Pass on an application/linkset+json or linkset document. | 1 | – | [RFC 9727 api-catalog](https://www.rfc-editor.org/rfc/rfc9727) |
| A4.3 | OAuth discovery | GET /.well-known/oauth-authorization-server and /.well-known/oauth-protected-resource. Pass when either returns valid JSON metadata. | 1 | – | [RFC 8414 OAuth 2.0 Authorization Server Metadata](https://www.rfc-editor.org/rfc/rfc8414), [RFC 9728 OAuth 2.0 Protected Resource Metadata](https://www.rfc-editor.org/rfc/rfc9728) |
| A4.4 | Agent Skills index | GET /.well-known/agent-skills/index.json. Pass on valid JSON listing at least one skill. | 1 | – | [Agent Skills specification](https://agentskills.io/home) |
| A4.5 | A2A agent card | GET /.well-known/agent-card.json. Pass on valid JSON with name, url and skills fields. | 1 | – | [Agent2Agent protocol](https://a2a-protocol.org/) |

## B1. Catalog exposure (commerce)

Can an agent read the catalog as data: Store API, feeds, and a sitemap that agrees with them?

| ID | Check | How it is tested | Weight | Depends on | Spec |
| --- | --- | --- | --- | --- | --- |
| B1.1 | WooCommerce detected | Informational. Detect wc/store in the REST index, a woocommerce body class or a WooCommerce generator meta tag. The result selects the profile; it is never scored. | info | – | [WooCommerce developer documentation](https://developer.woocommerce.com/docs/) |
| B1.2 | Store API reachable (WC) | GET /wp-json/wc/store/v1/products?per_page=1. Pass on 200 with a JSON array; fail on 401, 403, 404 or a non-JSON body. | 3 | B1.1 | [WooCommerce Store API](https://developer.woocommerce.com/docs/apis/store-api/) |
| B1.3 | Store API not rate-limited for reads (WC) | Three sequential product list requests. Fail on any 429 or 5xx; warn when a Retry-After header appears. | 2 | B1.2 | [WooCommerce Store API rate limiting](https://developer.woocommerce.com/docs/apis/store-api/rate-limiting/) |
| B1.4 | Store API product completeness (WC) | Sampled products must carry name, prices, images, stock status, permalink and categories. Pass when all do; warn when some lack images or categories; fail when prices or stock status are missing. | 2 | B1.2 | [WooCommerce Store API: products](https://developer.woocommerce.com/docs/apis/store-api/resources-endpoints/products/) |
| B1.5 | Public product feed discoverable | Look for links in llms.txt, robots.txt, the sitemap or a rel=alternate link tag pointing at a Google, Meta, ACP or OpenAI-style feed (XML, CSV, JSON). Pass when one is found and fetchable. | 2 | – | [Google Merchant Center product data specification](https://support.google.com/merchants/answer/7052112), [OpenAI product feed specification](https://developers.openai.com/commerce/specs/file-upload/products) |
| B1.6 | Feed freshness | Read Last-Modified on the feed response or a timestamp inside the feed. Pass within 24 hours; warn within 7 days; fail beyond. | 1 | B1.5 | [RFC 9110 HTTP Semantics (Last-Modified)](https://www.rfc-editor.org/rfc/rfc9110) |
| B1.7 | Catalog in sitemap matches Store API (WC) | Compare the product URL count in the sitemap with the X-WP-Total header of the Store API product list. Pass within 10 percent; warn within 25 percent; fail beyond. | 1 | A1.3, B1.2 | [WooCommerce Store API: products](https://developer.woocommerce.com/docs/apis/store-api/resources-endpoints/products/) |

## B2. Product structured data (commerce)

Do product pages carry schema.org Product markup with live price, availability, variants, shipping and returns?

| ID | Check | How it is tested | Weight | Depends on | Spec |
| --- | --- | --- | --- | --- | --- |
| B2.1 | Product JSON-LD on product pages | Parse all application/ld+json blocks on sampled product pages. Pass when every sampled page has a Product or ProductGroup node; warn when some do; fail when none do. | 3 | – | [schema.org Product](https://schema.org/Product), [Google product structured data](https://developers.google.com/search/docs/appearance/structured-data/product) |
| B2.2 | Offer with price, currency and availability | Each Product must carry an Offer (or AggregateOffer) with price, priceCurrency and an availability value that is a schema.org ItemAvailability URL. Pass when all sampled products do. | 3 | B2.1 | [schema.org Offer](https://schema.org/Offer), [schema.org ItemAvailability](https://schema.org/ItemAvailability) |
| B2.3 | Variants modeled | For products that appear variable (variation form or Store API type variable), expect a ProductGroup with hasVariant or Store API variations. Skip when no variable product was sampled. | 2 | B2.1 | [schema.org ProductGroup](https://schema.org/ProductGroup), [Google product variant structured data](https://developers.google.com/search/docs/appearance/structured-data/product-variants) |
| B2.4 | Shipping and return details in markup | Pass when Offers carry shippingDetails (OfferShippingDetails) and hasMerchantReturnPolicy (MerchantReturnPolicy); warn when only one is present. | 2 | B2.2 | [schema.org OfferShippingDetails](https://schema.org/OfferShippingDetails), [schema.org MerchantReturnPolicy](https://schema.org/MerchantReturnPolicy) |
| B2.5 | Images with alt text and resolution | The Product image must resolve, and the rendered img tag must carry alt text. Warn when the image is smaller than 800 px on its longest side (from HTML attributes or a HEAD request). | 1 | B2.1 | [Google Merchant Center image requirements](https://support.google.com/merchants/answer/6324350) |
| B2.6 | Markup matches visible page | Compare the JSON-LD price with the rendered price and the availability with the add-to-cart state. Fail on a price mismatch; warn on an availability mismatch. | 2 | B2.2, A3.2 | [Google structured data general guidelines](https://developers.google.com/search/docs/appearance/structured-data/sd-policies) |

## B3. Product identity (commerce)

Can an agent match products to real-world entities through GTIN, brand, MPN and SKU, the way Google, Meta, ACP and UCP require?

| ID | Check | How it is tested | Weight | Depends on | Spec |
| --- | --- | --- | --- | --- | --- |
| B3.1 | GTIN present | Read gtin, gtin8, gtin12, gtin13 or gtin14 from Product JSON-LD, or global_unique_id from the Store API. Pass when at least 80 percent of sampled products have one; warn above 50 percent; fail below. | 3 | – | [schema.org gtin](https://schema.org/gtin), [Google Merchant Center: gtin](https://support.google.com/merchants/answer/6324461) |
| B3.2 | GTIN valid | Each GTIN must be 8, 12, 13 or 14 digits and pass the GS1 check digit. Pass when all found GTINs are valid; fail when any is not. | 3 | B3.1 | [GS1 check digit calculation](https://www.gs1.org/services/how-calculate-check-digit-manually) |
| B3.3 | Brand present as entity | Pass when Product.brand is a Brand (or Organization) object with a name on all sampled products; warn when it is a bare string or its casing varies across the sample; fail when absent. | 2 | B2.1 | [schema.org Brand](https://schema.org/Brand) |
| B3.4 | MPN present when GTIN absent | For sampled products without a GTIN, pass when mpn and brand are both present. Skip when every sampled product has a GTIN. | 2 | B2.1 | [Google Merchant Center: mpn](https://support.google.com/merchants/answer/6324482) |
| B3.5 | SKU present and unique in sample | Read sku from JSON-LD or the Store API. Pass when all sampled products have one and no two share it; warn on a duplicate; fail when missing. | 2 | – | [schema.org sku](https://schema.org/sku) |
| B3.6 | Identity resolvable per channel | For each sampled product, evaluate the identity rule of each channel: Google and Meta need GTIN or brand plus MPN; ACP feeds need id plus gtin or brand; UCP catalogs need identifiers. Pass when at least 80 percent of sampled products resolve on every channel. The evidence is the per-product, per-channel table. | 3 | – | [Google Merchant Center: unique product identifiers](https://support.google.com/merchants/answer/160161), [Meta commerce catalog: supported fields](https://developers.facebook.com/documentation/ads-commerce/commerce-platform/catalog/fields), [OpenAI product feed specification](https://developers.openai.com/commerce/specs/file-upload/products), [Universal Commerce Protocol](https://ucp.dev/) |

## B4. Merchant trust and policies (commerce)

Are the policies a checkout needs (returns, shipping, privacy, terms) and the merchant's identity findable and readable?

| ID | Check | How it is tested | Weight | Depends on | Spec |
| --- | --- | --- | --- | --- | --- |
| B4.1 | Return policy page found | Follow homepage links whose text or URL matches return, refund, Widerruf, retour or similar, or MerchantReturnPolicy.merchantReturnLink. Pass when the page is fetchable and longer than 300 words. | 3 | – | [schema.org MerchantReturnPolicy](https://schema.org/MerchantReturnPolicy) |
| B4.2 | Shipping policy page found | Same link heuristics for shipping, delivery, Versand, livraison. Pass when the page is fetchable and mentions regions, costs or delivery times. | 3 | – | [schema.org OfferShippingDetails](https://schema.org/OfferShippingDetails) |
| B4.3 | Privacy policy and terms found | Look for the WordPress privacy page link, link text matching privacy, Datenschutz, terms, AGB, conditions. Pass when both pages are fetchable. | 3 | – | [WordPress privacy policy page](https://wordpress.org/documentation/article/settings-privacy-screen/) |
| B4.4 | Merchant identity | Pass when Organization JSON-LD (name, address or contactPoint) exists, or an imprint or about page carries a legal name and address. | 2 | – | [schema.org Organization](https://schema.org/Organization) |
| B4.5 | Contact channel | Pass when the homepage footer links to a mailto: address or a page whose URL or link text indicates a contact form. | 1 | – | [schema.org ContactPoint](https://schema.org/ContactPoint) |
| B4.6 | Policy pages are agent-readable | For each policy page found, require server-rendered text (as in A3.2) and no robots.txt or meta robots rule that blocks shopping agents. Skip when no policy page was found. | 2 | – | [RFC 9309 Robots Exclusion Protocol](https://www.rfc-editor.org/rfc/rfc9309) |
| B4.7 | security.txt | GET /.well-known/security.txt. Pass on a text document with Contact: and Expires: fields whose Expires date is in the future. | 1 | – | [RFC 9116 security.txt](https://www.rfc-editor.org/rfc/rfc9116) |

## B5. Checkout and payment protocols (commerce)

Can an agent start a transaction: UCP manifest, ACP checkout, payment handlers, guest checkout and cart API?

| ID | Check | How it is tested | Weight | Depends on | Spec |
| --- | --- | --- | --- | --- | --- |
| B5.1 | UCP manifest | GET /.well-known/ucp. Pass on valid JSON with a version and a capabilities array. The spec version the manifest declares is recorded in the evidence. | 2 | – | [Universal Commerce Protocol](https://ucp.dev/) |
| B5.2 | UCP capabilities declared | Pass when the manifest declares at least checkout; the evidence lists cart, catalog, order, identity linking and payment handlers. | 1 | B5.1 | [Universal Commerce Protocol](https://ucp.dev/) |
| B5.3 | ACP checkout endpoint advertised | Look for an OpenAPI document or discovery link pointing at checkout_sessions. Pass when HEAD or OPTIONS on the endpoint is reachable without creating a session. | 2 | – | [Agentic Commerce Protocol](https://www.agenticcommerce.dev/) |
| B5.4 | ACP feed policy fields | When an ACP or OpenAI-style feed is found, pass when seller_name, seller_url, return_policy and return_window are present on sampled items. Skip when no such feed exists. | 2 | B1.5 | [OpenAI product feed specification](https://developers.openai.com/commerce/specs/file-upload/products) |
| B5.5 | Payment-handler signals | Detect Google Pay, Apple Pay, Stripe Link or PayPal scripts or markers in the checkout page HTML. Pass when at least one is present. | 1 | – | [Google Pay API](https://developers.google.com/pay/api), [Apple Pay on the Web](https://developer.apple.com/apple-pay/) |
| B5.6 | AP2 or x402 signals | Informational. GET /.well-known/x402 and look for HTTP 402 payment-required headers on a probe. Pass when any signal is present. | 1 | – | [x402 payment protocol](https://x402.org/), [Agent Payments Protocol (AP2)](https://ap2-protocol.org/) |
| B5.7 | Guest checkout and cart API (WC) | GET /wp-json/wc/store/v1/cart must respond 200 with a cart object. Warn when the checkout page requires login (guest checkout disabled). | 2 | B1.2 | [WooCommerce Store API: cart](https://developer.woocommerce.com/docs/apis/store-api/resources-endpoints/cart/) |

## Fixes

Every check ships a fix in three forms: a sentence, a snippet or file when one applies, and a brief for a coding agent. Fixes marked **mechanical** are file, setting or markup changes that a tool or agent can apply from existing store data; the others need product knowledge or copy. The full text lives in `packages/catalog/fixes/<id>.md` and in the `fix` field of every failed check in a report.

| ID | Summary | Mechanical |
| --- | --- | --- |
| A1.1 | Serve a plain-text robots.txt at the site root that returns HTTP 200 and parses under RFC 9309. Even an empty file is better than a 5xx or a challenge page. | – |
| A1.2 | Publish an XML sitemap and declare it in robots.txt. WordPress ships one at /wp-sitemap.xml; SEO plugins usually replace it with /sitemap_index.xml. | – |
| A1.3 | Include every published product URL in the sitemap, ideally in a dedicated product sitemap referenced from the sitemap index, so an agent can enumerate the catalog without crawling. | – |
| A1.4 | Emit Link response headers on the front page that point agents at llms.txt, the product feed and any MCP server card. | yes |
| A1.5 | Serve /llms.txt: a Markdown file with an H1 (site name), a one-paragraph summary in a blockquote, and link sections for products, policies and APIs. | yes |
| A1.6 | Add a Catalog section to llms.txt that links to the product feed, the Store API or the product sitemap, so an agent can reach the catalog as data in one hop. | yes |
| A2.1 | State a decision for each major AI training crawler in robots.txt. Allowing or disallowing is the merchant's call; silence is what loses points. | yes |
| A2.2 | Allow user-triggered shopping agents (ChatGPT-User, Claude-User, OAI-SearchBot, Google-Agent, Perplexity-User) on product paths. These fetch on behalf of a person at the moment of shopping; blocking them removes the store from agent-assisted purchases. | yes |
| A2.3 | Declare Content Signals in robots.txt so AI systems can tell training, search and input use apart. | yes |
| A2.4 | Exempt known shopping-agent user agents from WAF challenges and bot-management rules on product and policy pages, and never serve different content to them than to browsers. | – |
| A2.5 | Publish an HTTP Message Signatures key directory so verified agent requests can be checked, and accept signed requests from known agents. | – |
| A2.6 | Remove noindex, nosnippet and noai directives from product pages, both in meta robots tags and X-Robots-Tag headers. | – |
| A3.1 | Answer requests with Accept: text/markdown on product and policy pages with a Markdown rendering of the product: title, price, stock, attributes, identifiers, description and policy links. | yes |
| A3.2 | Render product title, price and description into the HTML on the server. An app shell that fills in content with JavaScript is empty to most agents. | – |
| A3.3 | Keep product HTML under 500 KB and time to first byte under 1.5 seconds with page caching, deferred scripts and trimmed inline assets. | – |
| A3.4 | Add a rel=canonical link on every product page and, when the store runs in several languages, hreflang alternates for each. | – |
| A3.5 | Wrap the product content in a main landmark and keep consent overlays out of the document flow so the content is first in the DOM. | – |
| A4.1 | If the store runs an MCP server, publish a server card at /.well-known/mcp/server-card.json with a name and endpoint. | – |
| A4.2 | Publish an API catalog linkset at /.well-known/api-catalog listing the store's public APIs. | – |
| A4.3 | If any store API needs authorization, publish OAuth 2.0 authorization server and protected resource metadata so agents can discover how to obtain a token. | – |
| A4.4 | Publish an Agent Skills index at /.well-known/agent-skills/index.json that lists skills agents can load for this store. | – |
| A4.5 | If the store exposes an A2A agent, publish its agent card at /.well-known/agent-card.json with name, url and skills. | – |
| B1.1 | Informational. No fix: this check records whether WooCommerce was detected and selects the profile. | – |
| B1.2 | Make the WooCommerce Store API readable without credentials. It is public by default; a security plugin, a REST API restriction or a WAF rule is usually what blocks it. | – |
| B1.3 | Raise or scope the Store API rate limit so a few sequential anonymous reads do not return 429. | – |
| B1.4 | Fill in the product fields the Store API exposes: images, categories, stock status and prices for every published product. | – |
| B1.5 | Publish a product feed (Google or OpenAI format) at a stable URL and link it from llms.txt and a rel=alternate link tag. | – |
| B1.6 | Regenerate the feed at least daily and send an accurate Last-Modified header. | – |
| B1.7 | Make the sitemap and the Store API agree: include all published, visible products in the product sitemap and exclude hidden or draft products from both. | – |
| B2.1 | Emit schema.org Product JSON-LD on every product page. WooCommerce core emits a basic block; an SEO plugin may replace it. Only one should be active. | yes |
| B2.2 | Add an Offer to the Product markup with price, priceCurrency and an availability URL from schema.org/ItemAvailability. | yes |
| B2.3 | Expose variable products as a ProductGroup whose hasVariant lists each variation with its own sku, identifiers and offer. | yes |
| B2.4 | Add shippingDetails and hasMerchantReturnPolicy to each Offer, generated from the shipping zones and the return policy page. | yes |
| B2.5 | Give every product a primary image of at least 800 px on its longest side with descriptive alt text. | – |
| B2.6 | Generate the Product markup from the same product object that renders the page so price and availability can never diverge, and avoid caching markup separately from the page. | – |
| B3.1 | Enter a GTIN for every product and variant that has one, in the field the platform exposes to both its structured data and its API. On WordPress/WooCommerce that is the GTIN, UPC, EAN or ISBN field in the product inventory tab, which feeds the Store API and the JSON-LD. | yes |
| B3.2 | Fix GTINs that fail the GS1 check digit or have the wrong length. Leading zeros dropped by spreadsheets are the usual cause. | yes |
| B3.3 | Model the brand as a Brand object with a canonical name, sourced from one brand taxonomy rather than free text. | yes |
| B3.4 | For products without a GTIN (handmade, bespoke), set brand and MPN so channels can still identify them. | yes |
| B3.5 | Give every product and variation a unique SKU and expose it in markup and the product API. | yes |
| B3.6 | Complete product identity per channel: GTIN (or brand plus MPN) for Google and Meta, id plus gtin or brand for ACP feeds, identifiers for UCP catalogs. The check's evidence lists the sampled products and the channel each one fails. | – |
| B4.1 | Publish a return policy page of at least 300 words and link it from the footer and from MerchantReturnPolicy.merchantReturnLink. | yes |
| B4.2 | Publish a shipping policy page that names destinations, costs and delivery times, and link it from the footer. | yes |
| B4.3 | Publish a privacy policy page and a terms page, register them wherever the platform expects them, and link both from the footer of every page. | yes |
| B4.4 | Emit Organization JSON-LD with legal name, address and contact point, and publish an imprint or about page with the same details. | – |
| B4.5 | Link an email address or a contact form from the footer on every page. | – |
| B4.6 | Make policy pages server-rendered plain content, and keep them out of robots.txt Disallow rules and noindex directives. | – |
| B4.7 | Serve /.well-known/security.txt with a Contact and an Expires field. | yes |
| B5.1 | Serve a UCP manifest at /.well-known/ucp that declares the capabilities the store actually has. Declare checkout only when a UCP checkout handler is installed. | yes |
| B5.2 | Extend the UCP manifest with the capabilities the store supports: catalog, cart, checkout, order, identity linking and payment handlers. | – |
| B5.3 | Install an Agentic Commerce Protocol integration that exposes checkout_sessions and advertise it through an OpenAPI document or discovery link. | – |
| B5.4 | Add seller_name, seller_url, return_policy and return_window to every item in the ACP or OpenAI-style product feed. | – |
| B5.5 | Enable at least one express payment handler (Google Pay, Apple Pay, Stripe Link or PayPal) on the checkout page. | – |
| B5.6 | Informational. Publish /.well-known/x402 or AP2 discovery metadata only if the store supports agent payments. | – |
| B5.7 | Keep the Store API cart endpoint public and enable guest checkout in WooCommerce settings. | – |
