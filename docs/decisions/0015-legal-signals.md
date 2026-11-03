# 0015 Legal signals are reported on their own page, never scored and never crawled

Date: 2026-11-03. Status: accepted. The design is in [the legal-signals proposal](../proposals/2026-11-03-legal-signals.md). This record keeps what was decided.
Amended by [0017](0017-stepped-hosted-scans.md): hosted scans now run in steps with a budget of 60 requests, which replaces the single scan deadline mentioned under Consequences.

## Context

Online stores have legal duties toward their customers, and many of these duties leave public traces a scanner can read without running JavaScript. Examples:

- a seller identity block,
- a privacy notice and its contact,
- the EU withdrawal function with its prescribed label, and Argentina's botón de arrepentimiento (withdrawal button),
- a manufacturer on product pages,
- an accessibility statement,
- a machine-readable reservation of text and data mining (an opt-out from AI training).

Agents read the same traces when they decide whom to trust and cite. A scanner cannot know whether a law applies to a business (its size, whether it sells to consumers, where it sells), whether the disclosed content is true, or anything that happens after JavaScript, sign-in or checkout.

## Decision

- **A separate category.** The catalog gains `legal`: sections C1 to C6 and 24 checks, kept in `catalog.legal` beside the readiness `groups` and `checks`. Readiness surfaces stay untouched: scores, level, priorities, check map, scan console, history and monitoring diffs, and the knowledge-base index of the readiness checks (64 at the time).
- **Never scored.** Every legal check has weight `info`. There is no legal score and no level. Verdicts read Found, Review, Not found in the pages read, Not applicable and Could not check. Nothing says compliant or breach.
- **Laws as data.** `packages/catalog/data/legal/laws.json` holds each provision with its jurisdiction, market, official URL (EUR-Lex, legislation.gov.uk, fedlex, leginfo, planalto and the like), the day it applies from when that day is still ahead, and the day it was verified. Each check lists the laws it relates to. A check without one does not load.
- **Markets decide what runs.** The engine detects the markets a store sells to from these signals, and keeps every signal as evidence: the country-code domain, region subtags of the page language, hreflang alternates, the offer currency, countries in markup, and valid national register numbers. A check bound to markets runs only when one of them is detected. The CLI and the library can choose markets (`--markets eu,uk`). The hosted scanner detects them, because its root results are shared per host.
- **A page of its own, never crawled.** Results appear at `/sites/<host>/legal` and `/r/<id>/legal` (and as `.json` and `.md`). These pages are answered with `X-Robots-Tag: noindex, nofollow, noarchive`, disallowed for every user agent in robots.txt, absent from the sitemap, and linked from the report with `rel="nofollow"`. The readiness exports (`report.json`, `/r/<id>.json`) omit them. A disposable path scan, which has no URL, shows them at the end of its noindex document. The CLI and the MCP tool include them in their output.
- **The notice travels with the results.** `LEGAL_NOTICE` opens the HTML page, the Markdown, the JSON and every legal knowledge-base article. It says that the results are a technical evaluation, not legal advice. It says that the scanner cannot tell whether a law applies or whether the content is correct, and that it can be wrong when pages fail to load, render in the browser, block automated access, differ by region or use an unrecognised setup.
- **Knowledge base.** Each legal check has an article in the usual format, with its laws listed from the registry. The hub page `/knowledge-base/legal-signals` lists them all. These general explanations are indexable. The per-store results are not.
- **Last in the run.** The legal pass runs after the readiness checks, on the same target and fetcher. It mostly reads cached pages and never takes time or requests from a readiness check.

## Consequences

- The result object gains an optional `legal` block, and `scores` is unchanged. The schema id stays `agentic-readiness-scanner/1`. Results written before carry no `legal` block, and their legal page says so.
- A scan spends up to 3 more requests: `/.well-known/gpc.json` and at most 2 product images. The budget and deadline are unchanged.
- Law entries go stale. Re-verify them against the official text when laws change, and at least every few months. The `verified` field records when.
- What is out of scope stays out: cookie or accessibility "compliance", checkout-stage duties, marketplace-only rules (DSA Arts. 25 to 30), geo-blocking and personalised pricing.
