# Scoring

A scan produces two scores from 0 to 100 and one readiness level. The report calls them by plain names. **Visible to AI** is the ingestion score: can AI agents find and read the site? **Shoppable by AI** is the commerce score: can agents understand the products, trust the store and buy from it? The JSON keeps the keys `ingestion` and `commerce`. The level is gated, not averaged: a store reaches a level only when every check that level needs has passed. A merchant should never see a 72 and not know what it means.

## Scores

Each check has a weight in the catalog: 3 (blocking), 2 (expected), 1 (nice to have) or `info` (reported, never scored). Of the 86 readiness checks, 16 carry weight 3, 20 weight 2, 35 weight 1 and 15 are `info`, 6 of them technology checks that record how a store is built on its platform ([decision 0021](decisions/0021-technology-checks.md)).

For each dimension the score is the sum of the weights of passed checks, divided by the sum of the weights of applicable checks, times 100, rounded. A warn counts half. A skipped check drops out of the denominator, so a store is never punished for a check that did not run. A check is skipped when it does not apply to the profile or platform, when a check it depends on failed, when it is not implemented, or when the scan ran out of budget or time.

The commerce score is `null` for profiles without the commerce dimension (the content-site profile).

**Coverage.** Dropping skipped checks must not let a sliver of the catalog stand for the whole. Each dimension records `scores.coverage`: the share of its applicable weight the scan actually answered. A check is unanswered when it applied but could not run (time or request budget, an error, not implemented) or when its parent could not run. A dependent of a parent that failed is answered, because the parent carries the finding. Below 50% coverage a dimension is **incomplete**: commerce is `null`, section scores are `null`, and reports print "Incomplete" with the share instead of a number. Ingestion stays a number in JSON for compatibility, but reports mark it incomplete the same way. Before scoring 0.5.0, a store whose scan ran out of time after one passing commerce check read 100 for commerce.

**Order under a budget.** Checks run in dependency order. Level gates and blocking checks run first, then expected, nice-to-have and informational ones. A parent inherits the urgency of its most urgent dependent. When a scan uses up its request budget or its time limits, what is left unanswered is the optional probes, not the gates. Results are still listed in catalog order.

Two things are never scored:

- A decision to block AI training crawlers never costs points. A2.1 passes on any stated decision, allow or disallow.
- Optional conventions without a documented consumer carry weight 1 or are informational, and their checks skip when the file is absent. These are llms.txt (a Markdown file that points AI tools to a site's key pages), Content Signals (robots.txt lines that state how content may be used), security.txt (a file that names a security contact) and WebMCP (tools a page declares for agents in the browser).

**Ceilings.** A weighted average rewards many small things done well, so a store agents cannot buy from could read 90 for commerce. Ceilings tie each score to the capability that decides whether agents can use the store at all ([decision 0018](decisions/0018-score-ceilings.md)). They are data in `packages/catalog/data/ceilings.json`. While any gate of a ceiling is unmet, the dimension cannot score above the ceiling's value. Gates work as in levels: one passing alternative is enough, and alternatives outside the profile count as met.

A cap needs evidence. It holds only while an unmet gate has an alternative that failed or warned, or that was skipped because a check it depends on failed. A gate the scan could not evaluate, such as A3.2 when no product page was found to sample, still holds the level back but does not cap the score (since scoring 0.7.0).

| Ceiling       | Unmet gate                                                                                                                                          | Ingestion | Commerce |
| ------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- | --------- | -------- |
| not-crawlable | any Level 1 gate: A1.1, A2.2, A2.4, A3.2                                                                                                            | 40        | 30       |
| no-checkout   | a checkout an agent can use: B5.2 (UCP checkout capability and payment handler), B5.3 (ACP discovery document) or B5.8 (Shopify agentic storefront) | –         | 60       |

The lowest ceiling in force wins. The result records it in `scores.ceilings` with the raw weighted score, the reason and the checks that lift it. Every report states the cap next to the score, for example: `Capped at 60 while no checkout an agent can use is advertised. Without the cap it would be 88. Lifted by B5.2 … or B5.3 …`. When the raw score is already at or below the cap, the report says `Cannot exceed 60 while …` instead. Section scores are never capped. So a commerce score above 60 means a checkout an agent can use is advertised, unless the scan could not evaluate any of the checkout checks. An ingestion score above 40 means agents can reach and read the site, with the same exception for the Level 1 checks.

The same formula is applied per section (A1 to B5) and carried as `scores.groups`, keyed by section id and `null` when no check in the section applied. Reports show a score per section so a merchant can see at a glance which area needs work. The dimension scores remain the headline numbers.

## Levels

Levels are gates. A level holds only when every gate of that level is satisfied. A gate is satisfied when one of its alternatives passed. The one exception: a gate whose alternatives are all outside the profile's catalog is satisfied, so a content site is not held back by product-page gates. A check the profile does include but that could not run on this target blocks the gate, whatever the reason: no product pages were found, a dependency failed, the budget ran out, an error occurred, or the check is not implemented. A store whose product pages cannot be discovered therefore stays at Level 0 with A3.2 as its next gate. That is the honest reading of "an agent cannot read product content".

The catalog makes requirements explicit. A check may require a platform (`woocommerce`, `shopify`, `magento` and the other ids in `packages/catalog/src/platform-ids.ts`, where `wordpress` is also met by WooCommerce) or `products` (product pages were found). Profiles declare the requirements they can never meet. The runner evaluates the rest per target and reports unmet ones as `not_applicable` with the reason.

A platform check counts like any other check where it runs. The 12 platform checks added in catalog 0.7.0 ([decision 0019](decisions/0019-platform-specific-checks.md): A2.8 to A2.12, A3.12, A3.13, A4.7 to A4.9, B1.9 and B5.9) gate no level and lift no ceiling, because gates name capabilities, not platforms. Three older platform checks are alternatives next to platform-neutral ones: B1.2 (WooCommerce Store API) and B1.8 (Shopify products.json) at Level 2, and B5.8 (Shopify agentic storefront) at Levels 2 and 5 and in the no-checkout ceiling.

| Level | Name                  | Gate                                                                 |
| ----- | --------------------- | -------------------------------------------------------------------- |
| 0     | Not reachable         | default                                                              |
| 1     | Reachable             | A1.1, A2.2, A2.4, A3.2                                               |
| 2     | Readable catalog      | Level 1 and (A1.3 or B1.2 or B1.8 or B1.5 or B5.8), A2.6, B2.1, B2.2 |
| 3     | Trusted merchant      | Level 2 and B4.1, B4.2, B4.3, B4.5                                   |
| 4     | Identifiable products | Level 3 and (B3.1 or B3.4), B3.2, B3.3                               |
| 5     | Checkout-ready        | Level 4 and (B5.2 or B5.3 or B5.8)                                   |

A gate is met by a pass. Two checks also meet it with a warning, because their warning is about stated intent, not about reach: A1.1 warns when robots.txt is missing or is an HTML page (crawlers then read everything) or is larger than the 500 KiB Google reads, and A2.2 warns when exactly one minor crawler is blocked. Every other warning holds the level back. Trust comes before product identity: every agent checkout programme asks for return, shipping, privacy and terms pages and a contact before it lists a store, while none requires a GTIN. B3.2 passes when no product declares a GTIN, and fails on any invalid one, so a wrong number blocks Level 4 even when other products carry a brand and part number.

Reports name Level 0 by the Level 1 gate it misses, so a reader sees why: **Not reachable** when an honest request is blocked or challenged (A2.4) or robots.txt answers with an error (A1.1), **Closed to AI crawlers** when robots.txt keeps the crawlers behind AI answers away from product pages (A2.2), **Not readable** when the site answers but its product pages (or, for a site that sells nothing, its home page) show no content without JavaScript (A3.2), and **No product page found** when A3.2 could not run because no product page was read. While the scan could not answer a Level 1 check, Level 0 reads **Not decided yet**. One sentence under the heading says the same in plain words. The result's `level.name` stays the catalog name, `Not reachable`. The web app's scan answers add the shown name as `level_label`.

A check that could not be answered (the site rate-limited the scan, refused a page or did not answer in time) never counts as a failure. When only such checks stand between a store and the next level, the result lists them in `level.undetermined` and the report says the next level is not decided, rather than claiming the store missed it.

Each profile declares a maximum level: content sites stop at 1. A profile may also exclude checks that could never mean anything for it (a content site is not asked for product URLs in its sitemap). The report leads with the level and `next_gate`, the check ids standing between the store and the next level. Alternatives outside the profile are not listed, since the owner cannot act on them.

A gate whose check is not implemented yet blocks the level, by design: the scanner never awards a level it could not verify.

- Level 1 includes A2.4 (no block or challenge on the scanner's honest fetch). A store that challenges every unverified client is unreachable for every agent that is not on an allow list. A refused home page still produces a Level 0 report that names the bot-management product. A refused policy page alone does not cost the level ([decision 0012](decisions/0012-priorities-and-honest-non-answers.md)).
- Level 2 accepts several ways to list the catalog: a product sitemap (A1.3), the WooCommerce Store API (B1.2), Shopify's products.json (B1.8), a public product feed (B1.5) or an active Shopify agentic storefront (B5.8).
- Level 2 includes A2.6 (no directive keeps product pages out of AI answers). Google builds AI Overviews and AI Mode only from pages eligible for a snippet, and Apple generates no web answer without one. A catalog under `nosnippet` is not readable to them, whatever its markup says.
- Level 5 means the public prerequisites of a checkout protocol are in place: a UCP (Universal Commerce Protocol) profile that declares a checkout capability and a payment handler (an empty profile is not enough), an ACP (Agentic Commerce Protocol) discovery document, or an active Shopify agentic storefront. It never means a checkout was exercised. The same gate lifts the commerce ceiling, so the level and the score agree on whether agents can buy.

The reasons behind every gate are in the [check audit](audits/2026-10-31-check-audit.md) and the [technical SEO audit](audits/2026-11-01-technical-seo-audit.md).

## Profiles

A profile decides which checks apply and how high the level can go.

| Profile           | Applies                                                                                               | Max level |
| ----------------- | ----------------------------------------------------------------------------------------------------- | --------- |
| WooCommerce store | every check except those for other platforms (WordPress checks run too)                               | 5         |
| Other store       | every check except those that need WooCommerce. Checks for the detected platform run on that platform | 5         |
| Content site      | ingestion checks only, without product-page checks and the product sitemap check (A1.3)               | 1         |

The scanner picks the profile. A WooCommerce store gets the WooCommerce profile. WooCommerce is recognised on the home page or, for a WordPress site that also sells, on its first product page. A store on a platform that only runs shops (Shopify, BigCommerce, Adobe Commerce, Shopware, PrestaShop, Salesforce Commerce Cloud, Square Online, Ecwid) gets the other-store profile. So does any site with store signals: product pages were found, the home page links a shop-only listing (`/shop`, `/collections/…`, `/product-category/…`, `/catalog`), the home page shows store markers (an add-to-cart control, a cart link, Product or Offer markup), or the home page refused the scanner. A `/category/` link or an `ItemList` of articles is not a store signal, because blogs and news sites use both. Everything else is a content site. You can override the choice (`--profile` in the CLI, `profile` in the API).

## Versions

The catalog version changes whenever a check, weight, dependency or fix changes. The scoring version changes whenever weights, levels, ceilings or the formulas change. Both are recorded in every result so two reports can be compared, and a spec change becomes a catalog release rather than a silent score shift.

## Reading a report

Reports do not list findings in catalog order. Open findings are ordered by what unlocks the next level, then by tier (weight 3 blocking, 2 expected, 1 nice to have, then informational), then fail before warn. The HTML and Markdown reports open with that list. A section made only of nice-to-have and informational checks is tagged, so its score is not read as a red flag. A check the scanner could not answer (a page that did not download, a probe that was rate limited) is skipped with reason `error` and drops out of the score. It is never a fail ([decision 0012](decisions/0012-priorities-and-honest-non-answers.md)).

## What a score does not say

A commerce score above 60 means the public surface is in order and a checkout an agent can use is advertised. It does not say Google Merchant Center approved the products or that a checkout works. The report says so above the commerce section, and Level 5 is named Checkout-ready, not Approved.
