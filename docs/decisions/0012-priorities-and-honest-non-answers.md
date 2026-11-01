# 0012. Reports lead with priorities, and a page the scanner did not read is never scored

Date: 2026-11-01. Status: accepted.

## Context

Two audits had made the catalog deep. A third pass read the reports the way a store owner does and scanned fifteen real stores with them ([the audit](../audits/2026-11-01-report-and-accuracy-audit.md)). Three things were wrong with the output rather than with the checks.

The report listed findings in catalog order. A missing A2A agent card (weight 1, no consumer) came before a product page without an Offer (weight 3, a Level 2 gate). Nineteen fixes each carried the same five working rules for coding agents, so a Markdown report ran to 78 KB. Thirteen "fail" badges on one store included eight optional protocols nobody requires, and two whole groups scored 0 of 100 in red for the same reason.

Pages the scanner never read were scored as if they were empty. A dropped connection on one of two sampled product pages produced failures for server rendering, canonical, viewport, JSON-LD and SKU and demoted a healthy store to Level 0. A home page that answered 403 produced no report at all, although the level table defines exactly that case as Level 0, and the CLI called a site that had refused the scanner "not reachable".

Heuristics picked the wrong page and then judged it: a product named "WooCommerce Shipping" as the shipping policy, two product pages whose slugs contained "feed" as feed candidates, a category index as the listing page, a sports-bra collection as a contact page, because the patterns matched substrings anywhere in a URL.

## Decision

**Priorities, computed once.** `prioritize()` in `packages/core/src/reporters/priorities.ts` orders every open finding: next-gate checks first (tagged with the level they unlock), then by tier, then fail before warn, then catalog order. Tiers come from the weights the catalog already defines: 3 is blocking, 2 expected, 1 nice to have, info informational. Every surface renders the same list: the HTML report opens with a "What to do" card (Fix first, Fix next, Nice to have, Informational), the Markdown report has the same sections before the per-check results, and the summary line counts open findings per tier instead of only verdicts. A group made only of nice-to-have and informational checks is tagged and its score is muted, because a 0 there is not a red flag. Skips are counted as "did not apply" (profile, platform, nothing to sample) separately from "could not run".

**One copy of the working rules.** The Markdown report prints the five rules for coding agents once, at the end, and each fix carries the task, the question, the method and the specifications. The self-contained brief per finding stays available in the HTML report and through the MCP `get_fix` tool.

**Absence of an optional file is not a verdict.** Informational checks on optional files (usage-preference signals, WebMCP declarations, security.txt) skip as not applicable when the file is absent, as the llms.txt check already did, instead of passing or failing on nothing.

**Never score what was not read.** `readableProductPages()` hands content checks only the sampled pages that answered 2xx; when some failed the message says so, and when none could be read the check skips with reason `error` and the failure text, never as a fail. A refused home page (401, 402, 403, 406, 429, 451, or a challenge page) no longer aborts the scan: the resolver records the refusal and the bot-management product behind it when the response names one (Cloudflare, Akamai, DataDome, Vercel, Imperva, HUMAN, AWS WAF), the runner evaluates only robots.txt, the sitemap and the refusal itself, every other check is marked not evaluated with a pointer to A2.4, and the report is a Level 0 report that names the vendor. Only a 404, 410, 5xx or no response at all is "not reachable". A policy page that refuses the scanner no longer costs the level: A2.4 passes with a note and B4.6 reports what the agent cannot read. Rate-limited probes (429) are inconclusive, not findings. The fetcher paces requests, retries once on a dropped connection or a short Retry-After, and the scan lists every request that failed in its warnings.

**Pick pages by label, not by substring.** Policy links are ranked: a label made of policy words outranks a product name that carries the word, a footer link outranks a body link, a matching last path segment adds a little, and product, listing and account URLs are never candidates. Keywords match as whole words with their compounds (Versandkosten, not Versandlager; reso, not resources). A policy page that turns out to be a product page (Product JSON-LD or an add-to-cart control) fails the policy check with that reason. The listing page is the most-linked concrete collection or category, never a product page. Store detection reads cart vocabulary in the languages the policy patterns cover and Product JSON-LD, not English alone.

**next_gate lists what the owner can act on.** Gate alternatives outside the profile (a WooCommerce check on a Shopify store) are not listed.

## Consequences

The result schema is unchanged: priorities are derived at render time from fields every result already carries, so stored reports and the history tier keep working. Scores and levels move for some stores: a store whose only problem was a dropped connection, a refused policy page or a mislabelled link now gets the level its public surface earns, and the catalog version records the change (0.4.0, scoring 0.4.0) so two reports can be compared honestly.

The profile schema gains `excluded_checks` so a content site is not scored on product URLs in its sitemap. Scans take a few seconds longer because of pacing; the request budget is unchanged.

What this does not do: it does not make the scanner a browser. A page that renders its products with JavaScript is still empty to it, and the report says so in a "what this scan did not do" note rather than guessing.
