# Report and accuracy audit, 2026-11-01

Third audit of the scanner, after the [check audit](2026-10-31-check-audit.md) (what to check) and the [technical SEO audit](2026-11-01-technical-seo-audit.md) (what AI answers inherit from search). This one asked a different question: when a store owner reads a report, is it right, and does it tell them what to do? Four passes: a report read end to end as an owner would; one scan of each of fifteen real stores with every verdict checked against the live site; a survey of the vendor programmes and the comparable tools for requirements the catalog missed or over-claimed; and a check-by-check pass over weights, wording and redundancy. The outcome is catalog 0.4.0 and scoring 0.4.0, [decision 0012](../decisions/0012-priorities-and-honest-non-answers.md), and the changes below.

## 1. Reading a report as an owner

The report for woocommerce.com (Level 1, 32 requests) was correct on its headline and wrong in its shape.

- Fixes came in catalog order. The first three were Link response headers, an llms.txt catalog link and the training-crawler statement, all weight 1; the Offer that stood between the store and Level 2 was the eleventh.
- Thirteen "fail" badges counted eight optional protocols (MCP card, API catalog, A2A card, UCP profile, ACP document, public feed, Markdown copy, Link headers) next to five real problems, and two groups scored 0 of 100 in red because they contain nothing a store is required to have.
- Nineteen fixes each repeated the five working rules and the attribution paragraph for coding agents; the Markdown report ran to 78 KB and 1,421 lines.
- Two verdicts were wrong: the shipping policy "found" was the product page of a shipping extension, and the feed check had tried two product pages whose slugs contained "feed". Three messages did not say which image, which field or which page was the problem.

## 2. Fifteen real stores

One scan each, default budget, from a Swiss residential address, with every suspicious verdict re-checked by hand against the live site (at most three requests per site, stopping at the first 429).

| Site                                                                                        | What happened                                                                                                                                  | Scanner fault found                                                                                                                                                                                                                                                                                                                                                             |
| ------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| adidas.com, zalando.de, etsy.com, fredperry.com, porterandyork.com, www2.hm.com, bombas.com | Home page answered 403 (Akamai, DataDome, Cloudflare challenge) or 429 (Vercel challenge); the CLI printed "not reachable" and wrote no report | A refused home page must be a Level 0 report that names the vendor, not an abort                                                                                                                                                                                                                                                                                                |
| thomann.de                                                                                  | Scored as a content site at Level 0                                                                                                            | Store signals were English only ("Warenkorb" not recognised); gzip child sitemaps were dropped silently; two policy pages answered 429 after an unpaced burst and a warn on A2.4 sank the level; an SVG `<title>` in the body failed the head check; "Versandlager" matched the shipping pattern                                                                                |
| ikea.com                                                                                    | Level 1                                                                                                                                        | `prod-*.xml` sitemaps not recognised as product sitemaps; a category index chosen as the listing page; next_gate listed WooCommerce and Shopify checks on a profile that excludes them; B2.6 claimed availability matched when it was not compared; a GET on a UCP REST base URL answering 404 was a finding                                                                    |
| gymshark.com                                                                                | Level 0                                                                                                                                        | One of two product pages failed to download (transport error) and was scored as empty content, taking A3.2, A3.4, A3.5, A3.10, B2.1 and B3.5 with it; ProductGroup variants were not read, so B2.2 and B3.1 failed on complete data; "support" inside a sports-bra URL became a contact page; the apex redirect to another host was described as "answers with its own content" |
| fashionnova.com, skullcandy.com                                                             | Level 1                                                                                                                                        | The same ProductGroup blind spot (a Level 2 gate failing on correct markup); "Promo T&Cs" chosen over "Terms of Service"; a Shopify CDN image with a width parameter not matched to the JSON-LD image; "HTTP 0" printed for a URL the scanner itself declined to fetch because robots.txt disallows it                                                                          |
| colourpop.com                                                                               | Level 2                                                                                                                                        | A product page chosen as the listing page; the EU withdrawal form chosen as the return policy; internal codes counted as GTINs before the validity check contradicted it                                                                                                                                                                                                        |
| brooklinen.com                                                                              | Level 1                                                                                                                                        | A listing passed on a single product link                                                                                                                                                                                                                                                                                                                                       |
| developer.mozilla.org                                                                       | Level 1 (profile maximum)                                                                                                                      | Scored on product URLs in its sitemap; an SVG title failed the head check; the Italian "reso" matched "resources"                                                                                                                                                                                                                                                               |

Nothing crashed; the longest scan took 59 s because of four transport failures with the per-request timeout.

## 3. What changed

### Reports

- Every report opens with what to do. `prioritize()` orders open findings by the gate they unlock, then tier (weight 3 blocking, 2 expected, 1 nice to have, informational), then fail before warn. HTML shows a "What to do" card with Fix first, Fix next, Nice to have and Informational; Markdown has the same sections, then results by section, then fixes in that order.
- Summary lines count open findings per tier and split skips into "did not apply" and "could not run". Groups made only of optional checks are tagged and their score muted.
- The Markdown report prints the working rules for coding agents once. The self-contained brief per finding stays in the HTML report and the MCP `get_fix` tool.
- Messages name the thing: the image URL and its issue, which of brand and MPN is missing, which pages were counted as contact pages, the from and to of a redirect, the vendor behind a refusal, the reason a page was not fetched.

### Honesty about what was not read

- A refused home page (401, 402, 403, 406, 429, 451 or a challenge page) produces a Level 0 report: A2.4 fails and names the product behind the refusal when the response does, robots.txt and the sitemap are still evaluated, every other check is marked not evaluated with a pointer to A2.4. Only 404, 410, 5xx or no response is "not reachable".
- Content checks judge only sampled pages that answered 2xx. A page that failed to download is named in the message and never scored; when none could be read the check skips with reason `error`.
- A refused policy page no longer costs the level: A2.4 passes with a note and B4.6 reports it. Rate-limited probes are inconclusive. Absent optional files (usage-preference signals, WebMCP, security.txt) are not applicable, not a pass or a fail.
- The fetcher inflates gzip sitemaps, keeps at least 150 ms between requests, retries once on a dropped connection or a short Retry-After, and the scan lists every request that failed.

### Picking the right page

- Policy links are ranked by label quality, footer position and path; keywords match as whole words with their compounds; product, listing and account URLs are never candidates; a policy page that is a product page fails the check with that reason; on Shopify the platform's own policy page replaces a pick matched by path alone.
- The listing page is the most-linked concrete collection or category, never a product page; a category index without product links is not a finding.
- Store detection reads cart vocabulary in the languages the policy patterns cover and Product JSON-LD. Product sitemap names from large platforms (`prod-`, `products_N`, `artikel`) are recognised; Shopify's store root is no longer counted as a product URL; child sitemaps that fail to parse are named in the warnings.
- Contact links match whole words in short labels or the last path segment, never product or listing pages.

### Structured data read the way platforms write it

- ProductGroup variants carry offers, GTINs, MPNs and SKUs; B2.2, B2.3, B2.4, B3.1 and B3.4 read them.
- A GTIN counts only when it is 8, 12, 13 or 14 digits; other values are recorded as not a GTIN.
- B2.5 matches rendered images by path with size parameters removed, including `srcset` and `<picture>`, prefers an image with alt text, treats a failed HEAD as inconclusive and names the image and its issue.
- Organization-level return and shipping policy markup, which Google now documents as the standard place, satisfies B2.4.

### Catalog corrections from the landscape research

The research pass checked every vendor programme and twenty comparable tools against the catalog. What changed as a result: B1.8 (Shopify `products.json`, undocumented and rate-limited) weighs 2 and a 429 is inconclusive; B5.8 (the UCP catalog Shopify serves by default) weighs 3 and counts as a readable catalog for Level 2; A3.5 (main landmark) is informational because no answer engine documents depending on it; A1.3 does not apply to content sites; the A1.5 Lighthouse claim, the A2.1 timing for the shared training token, the A2.2 citations for ChatGPT search and Perplexity, the A2.6 Bing dates and Amazon's reading of `noarchive`, the B2.1 rationale (Merchant Center and Bing, not AI Overviews), the B5.1 and B5.3 wording, the B5.8 fix (the channel is on by default) and a dozen moved vendor URLs were corrected. The research report also confirmed that the catalog's refusals hold: no vendor documents reading llms.txt, a public feed, an API catalog or an A2A card, so those stay nice to have.

## 4. Considered and not done

- A `platform` value for headless Shopify. The result schema's platform enum is a published contract; the resolver records Shopify hosting separately and the Shopify-only checks skip on a headless storefront instead.
- Requiring a contact page rather than an email address (Microsoft Merchant Center's "customer service URL"). The page could not be read to cite; B4.5 keeps passing on an address and names the pages it found.
- Checking cart or checkout pages over HTTPS, contact email domains, attribute completeness scores, accessible names on add-to-cart controls. Each is a guidance checklist or an insight feature, not an eligibility rule, and would add noise.
- Serving `/agents.md` as an llms.txt alias. Shopify documents serving it, nobody documents reading it, and probing it would cost every scan a request.
- Rendering JavaScript. The scanner reads what crawlers read without a browser and says so.

## 5. Verification

`pnpm check` green; the recorded WooCommerce store reaches Level 5, the recorded Shopify store Level 3, the content site Level 1. Live re-scans after the changes are recorded in the pull request.
