# Report and accuracy audit, 2026-11-01

**What was audited.** The reports the scanner produces, and the verdicts in them. This is the third audit, after the [check audit](2026-10-31-check-audit.md) (what to check) and the [technical SEO audit](2026-11-01-technical-seo-audit.md) (what AI answers inherit from search engines).

**Why.** The first two audits asked whether the checks were the right ones. This one asked a different question: when a store owner reads a report, is it right, and does it tell them what to do?

**How.** Four passes:

1. One report read end to end, the way an owner would read it.
2. One scan of each of 15 real stores, with every verdict checked against the live site.
3. A survey of the vendor programmes and comparable tools, looking for requirements the catalog (the list of checks) missed or overstated.
4. A check-by-check pass over weights, wording and overlap.

**Outcome.** Catalog 0.4.0 and scoring 0.4.0, [decision 0012](../decisions/0012-priorities-and-honest-non-answers.md), and the changes below.

## 1. Reading a report as an owner

The report for woocommerce.com (Level 1, 32 requests) had the right headline but the wrong shape.

- Fixes came in catalog order. The first three were Link response headers, an llms.txt catalog link and the training-crawler statement, all weight 1 (nice to have). The Offer that stood between the store and Level 2 came eleventh.
- Thirteen "fail" badges counted eight optional protocols (MCP card, API catalog, A2A card, UCP profile, ACP document, public feed, Markdown copy, Link headers) next to five real problems. Two sections scored 0 of 100 in red, although they contain nothing a store is required to have.
- Each of the 19 fixes repeated the five working rules and the attribution paragraph for coding agents. The Markdown report ran to 78 KB and 1,421 lines.
- Two verdicts were wrong. The shipping policy "found" was the product page of a shipping extension. The feed check had tried two product pages whose slugs contained "feed". Three messages did not say which image, which field or which page was the problem.

## 2. Fifteen real stores

One scan each, with the default budget, from a Swiss residential address. Every suspicious verdict was re-checked by hand against the live site, with at most three requests per site, stopping at the first 429 (the status code for "too many requests").

| Site                                                                                        | What happened                                                                                                                                  | Scanner fault found                                                                                                                                                                                                                                                                                                                                                             |
| ------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| adidas.com, zalando.de, etsy.com, fredperry.com, porterandyork.com, www2.hm.com, bombas.com | Home page answered 403 (Akamai, DataDome, Cloudflare challenge) or 429 (Vercel challenge). The CLI printed "not reachable" and wrote no report | A refused home page must be a Level 0 report that names the vendor, not an abort                                                                                                                                                                                                                                                                                                |
| thomann.de                                                                                  | Scored as a content site at Level 0                                                                                                            | Store signals were English only ("Warenkorb" not recognised). Gzip child sitemaps were dropped silently. Two policy pages answered 429 after an unpaced burst, and a warn on A2.4 sank the level. An SVG `<title>` in the body failed the head check. "Versandlager" matched the shipping pattern                                                                               |
| ikea.com                                                                                    | Level 1                                                                                                                                        | `prod-*.xml` sitemaps not recognised as product sitemaps. A category index chosen as the listing page. `next_gate` listed WooCommerce and Shopify checks on a profile that excludes them. B2.6 claimed availability matched when it was not compared. A GET on a UCP REST base URL answering 404 was a finding                                                                  |
| gymshark.com                                                                                | Level 0                                                                                                                                        | One of two product pages failed to download (transport error) and was scored as empty content, taking A3.2, A3.4, A3.5, A3.10, B2.1 and B3.5 with it. ProductGroup variants were not read, so B2.2 and B3.1 failed on complete data. "support" inside a sports-bra URL became a contact page. The apex redirect to another host was described as "answers with its own content" |
| fashionnova.com, skullcandy.com                                                             | Level 1                                                                                                                                        | The same ProductGroup blind spot (a Level 2 gate failing on correct markup). "Promo T&Cs" chosen over "Terms of Service". A Shopify CDN image with a width parameter not matched to the JSON-LD image. "HTTP 0" printed for a URL the scanner itself declined to fetch because robots.txt disallows it                                                                          |
| colourpop.com                                                                               | Level 2                                                                                                                                        | A product page chosen as the listing page. The EU withdrawal form chosen as the return policy. Internal codes counted as GTINs before the validity check contradicted it                                                                                                                                                                                                        |
| brooklinen.com                                                                              | Level 1                                                                                                                                        | A listing passed on a single product link                                                                                                                                                                                                                                                                                                                                       |
| developer.mozilla.org                                                                       | Level 1 (profile maximum)                                                                                                                      | Scored on product URLs in its sitemap. An SVG title failed the head check. The Italian "reso" matched "resources"                                                                                                                                                                                                                                                               |

Nothing crashed. The longest scan took 59 s because of four transport failures, each waiting for the per-request timeout.

## 3. What changed

### Reports

- Every report opens with what to do. `prioritize()` orders open findings by the gate they unlock, then by tier (weight 3 blocking, 2 expected, 1 nice to have, informational), then fail before warn. The HTML report shows a "What to do" card with Fix first, Fix next, Nice to have and Informational. The Markdown report has the same sections, then results by section, then fixes in that order.
- Summary lines count open findings per tier and split skips into "did not apply" and "could not run". Sections made only of optional checks are tagged, and their score is muted.
- The Markdown report prints the working rules for coding agents once. The self-contained brief for a coding agent per finding stays in the HTML report and the MCP `get_fix` tool.
- Messages name the thing: the image URL and its issue, which of brand and MPN is missing, which pages were counted as contact pages, the from and to of a redirect, the vendor behind a refusal, and the reason a page was not fetched.

### Honesty about what was not read

- A refused home page (401, 402, 403, 406, 429, 451 or a challenge page) produces a Level 0 report. A2.4 fails and names the product behind the refusal when the response does. robots.txt and the sitemap are still evaluated. Every other check is marked not evaluated, with a pointer to A2.4. Only 404, 410, 5xx or no response counts as "not reachable".
- Content checks judge only sampled pages that answered 2xx. A page that failed to download is named in the message and never scored. When none could be read, the check skips with reason `error`.
- A refused policy page no longer costs the level. A2.4 passes with a note, and B4.6 reports it. Rate-limited probes are inconclusive. Absent optional files (usage-preference signals, WebMCP, security.txt) are not applicable, not a pass or a fail.
- The fetcher unpacks gzip sitemaps, keeps at least 150 ms between requests, and retries once on a dropped connection or a short Retry-After. The scan lists every request that failed.

### Picking the right page

- Policy links are ranked by label quality, footer position and path. Keywords match as whole words, including compounds. Product, listing and account URLs are never candidates. A policy page that is a product page fails the check with that reason. On Shopify the platform's own policy page replaces a pick matched by path alone.
- The listing page is the most-linked concrete collection or category, never a product page. A category index without product links is not a finding.
- Store detection reads cart vocabulary in the languages the policy patterns cover, and Product JSON-LD (structured data in the page that machines read). Product sitemap names from large platforms (`prod-`, `products_N`, `artikel`) are recognised. Shopify's store root no longer counts as a product URL. Child sitemaps that fail to parse are named in the warnings.
- Contact links match whole words in short labels or in the last path segment, and never product or listing pages.

### Structured data read the way platforms write it

- ProductGroup variants carry offers, GTINs (global barcode numbers), MPNs (manufacturer part numbers) and SKUs. B2.2, B2.3, B2.4, B3.1 and B3.4 read them.
- A GTIN counts only when it has 8, 12, 13 or 14 digits. Other values are recorded as not a GTIN.
- B2.5 matches rendered images by path with size parameters removed, including `srcset` and `<picture>`. It prefers an image with alt text, treats a failed HEAD as inconclusive, and names the image and its issue.
- Return and shipping policy markup at the Organization level, which Google now documents as the standard place, satisfies B2.4.

### Catalog corrections from the landscape research

The research pass checked every vendor programme and 20 comparable tools against the catalog. These changed as a result:

- B1.8 (Shopify `products.json`, undocumented and rate-limited) weighs 2, and a 429 is inconclusive.
- B5.8 (the UCP catalog Shopify serves by default) weighs 3 and counts as a readable catalog for Level 2. UCP is the Universal Commerce Protocol, an open standard for agents to discover and buy from stores.
- A3.5 (main landmark) is informational, because no answer engine documents depending on it.
- A1.3 does not apply to content sites.
- Corrected texts: the A1.5 Lighthouse claim, the A2.1 timing for the shared training token, the A2.2 citations for ChatGPT search and Perplexity, the A2.6 Bing dates and Amazon's reading of `noarchive`, the B2.1 rationale (Merchant Center and Bing, not AI Overviews), the B5.1 and B5.3 wording, the B5.8 fix (the channel is on by default) and a dozen moved vendor URLs.

The research report also confirmed that the catalog's refusals hold. No vendor documents reading llms.txt, a public feed, an API catalog or an A2A card, so those stay nice to have.

## 4. Considered and not done

- **A `platform` value for headless Shopify** (a store whose front end is not served by Shopify). The platform list in the result schema is a published contract. The resolver records Shopify hosting separately instead, and the Shopify-only checks skip on a headless storefront.

  Later: release 0.13.0 added 10 platform values to `target.platform` without a new schema id, and consumers treat a value they do not know as `unknown` ([decision 0019](../decisions/0019-platform-specific-checks.md)). Headless Shopify still has no value of its own.

- **Requiring a contact page rather than an email address** (Microsoft Merchant Center's "customer service URL"). The scanner could not read such a page to cite it. B4.5 keeps passing on an address and names the pages it found.
- **Checking cart or checkout pages over HTTPS, contact email domains, attribute completeness scores, accessible names on add-to-cart controls.** Each is a guidance checklist or an insight feature, not an eligibility rule, and would add noise.
- **Serving `/agents.md` as an llms.txt alias.** Shopify documents serving it, nobody documents reading it, and probing it would cost every scan a request.
- **Rendering JavaScript.** The scanner reads what crawlers read without a browser, and says so.

## 5. Verification

`pnpm check` passes (core 634 tests, web 56, cli 12, mcp 5, catalog 8, ui 4). The recorded WooCommerce store reaches Level 5, the recorded Shopify store Level 3 and the content site Level 1. Live re-scans through the development server on the finished build, the same day:

| Site            | Before                | After                      | What changed                                                                                                                                                                                                                                             |
| --------------- | --------------------- | -------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| adidas.com      | no report (exit 2)    | Level 0 report, 6 requests | A2.4 names Akamai. robots.txt (403) and the missing sitemap are evaluated. The other 57 checks say "not evaluated: the home page refused the scanner"                                                                                                    |
| gymshark.com    | Level 0               | Level 4                    | Headless Shopify recognised (B1.8 and B5.8 not applicable). 14 variant offers and GTINs read. The apex redirect described as consolidation on us.checkout.gymshark.com. The contact channel is the help centre on support.gymshark.com                   |
| ikea.com        | Level 1               | Level 5                    | The first 214 entries of a 5 MB product sitemap are used. The listing page is a concrete category. `next_gate` no longer lists Shopify checks. The UCP handler is named with its test environment                                                        |
| skullcandy.com  | Level 1               | Level 2                    | Variant offers read. The MCP probe that robots.txt refused is explained                                                                                                                                                                                  |
| colourpop.com   | Level 2               | Level 1                    | Honest: two of four variant offers lack availability, which B2.2 now sees. GTIN values that are internal codes are not counted, and the brand plus MPN alternative is credited                                                                           |
| woocommerce.com | Level 1               | Level 1                    | The shipping extension is no longer taken for a shipping policy. The support form in the account area is no longer a contact page. The product sitemap over 2 MB is read in part. Two policy pages are recognised on automattic.com and wordpress.com    |
| thomann.de      | content site, Level 0 | store, Level 0             | German cart vocabulary makes it a store, and the shipping page is the right one. The host rate-limits the scanner's address after the day's scans, so the report lists the 429s, backs off and stops after three persistent ones instead of scoring them |

Requests per scan stayed between 6 (a refused home page) and 36, within the budget of 40. A scan takes 9 to 27 s with pacing, longer only when a store keeps answering 429.

Later: since release 0.11.0 the hosted scanner allows 60 requests per scan and runs a scan in steps. The CLI default is still 40.
