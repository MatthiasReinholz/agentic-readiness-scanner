# 0020 Crawlers live in one registry as catalog data, and the scanner still never impersonates them

Date: 2026-11-10. Status: accepted. Amends [0010](0010-honest-fetch.md) with new evidence and keeps its rule.

## Context

The access checks evaluate robots.txt per crawler. Until catalog 0.12.0 the tokens were three arrays in `packages/core/src/checks/crawlers.ts`, and the same names were typed again in check methods, fixes, articles and the generated docs. A review against the operators' own documentation on 2026-11-10 found the cost of that:

- **Gaps.** Operators document clients the lists did not have: Claude-Agent (Anthropic's hosted browser), Google-GeminiNotebook, Kimi's three tokens, YouBot (hard-coded once in a platform check), DuckAssistBot classed as an index crawler although DuckDuckGo documents it as a live fetcher, and others.
- **Errors.** Bytespider was listed as a training crawler, a purpose only third parties claim; its operator's page could not be read. A method said Claude's search draws on Brave, which no Anthropic page states. Google-Extended was treated as training-only, but Google documents that it also governs grounding in Gemini Apps.
- **Drift.** The same list existed in up to six places, and they disagreed.

The review also asked whether the scanner should test how a site answers named AI crawlers: fetch a page as GPTBot or ChatGPT-User and compare. Bot managers now block AI clients by category at the edge (Cloudflare's AI Crawler and Agent access policies, Vercel's AI Bots ruleset, AWS WAF's CategoryAI), invisibly to an honest scan. Cloudflare documents that its policies apply to verified bots and to unverified clients that send a matching user agent, which weakens one argument of decision 0010: on Cloudflare, a spoofed GPTBot would often meet the same rule as the real one.

## Decision

**One registry.** `packages/catalog/data/crawlers.json` holds every token the access checks read, validated by `CrawlerRegistrySchema`. An entry records the operator, the kind of client (crawler, fetcher, agent, or a robots.txt token that makes no requests), its documented purposes (training, search index, live answers, tasks for a person), a tier, what the operator says about robots.txt, a documented fallback group, the published IP list or Web Bot Auth signature agent, the operator's documentation URL and the date it was verified. Only tokens their operators document go in. The registry also lists outdated names that robots.txt files still use, assistants with no robots.txt token, and the bot managers whose AI settings the scanner can point to.

**Sets, not lists.** Code and text read named sets: `training`, `index`, `fetchers` and `answers`, narrowed by tier or robots.txt behaviour (`index.core`, `fetchers.may-ignore`). `packages/core/src/checks/crawlers.ts` builds the engine's lists from them. Fixes, articles and guides write placeholders (`{{crawlers:index.core}}`, `{{robots:fetchers}}`, `{{count:training}}`) that the catalog build fills; an unknown set fails the build. The knowledge base renders the registry at `/knowledge-base/crawlers` and under each access-check article, and `docs/checks.md` lists it.

**Tiers decide the cost of a block.** `core` is the two indexes most AI answers draw on, Google and Bing: blocking one fails A2.2. `assistant` is a general-purpose assistant's own index crawler or fetcher, offered worldwide: two blocked fail A2.2, one warns, and in A2.5 one blocked fails. `other` is a regional search engine, a developer API or a crawl service: reported in the message and evidence, never changing A2.2's verdict, and only a warning in A2.5. The policy-page check (B4.6) and the text-and-data-mining check (C6.2) ask only about core and assistant crawlers that fetch pages, so a regional block or a Google-Extended training reservation does not make a policy page unreadable.

**Google-Extended counts in A2.2.** Google ties Gemini app grounding to it, so disallowing it is reported as a warning there, with Google's own wording. Blocking a training-only token still never costs points.

**Two new checks.** A2.13 (weight 1) warns when robots.txt names an outdated token, such as anthropic-ai, without the operator's current tokens, so the rule reaches no crawler. A2.14 (info) recognises the CDN or bot manager in front of the site from response headers, and Cloudflare's managed block in robots.txt, and tells the owner where the AI crawler rules are set. It never claims a block or its absence.

**Still no impersonation.** The scanner keeps sending only its own user agent. The new evidence does not change the decision, for three reasons:

1. A spoofed request appears in the site owner's AI crawler analytics as a real GPTBot or ChatGPT-User visit. The scan would corrupt the very data the owner uses to judge AI traffic.
2. Outside Cloudflare's user-agent match, verification by IP address or signature is the norm (Akamai, AWS WAF, Vercel, DataDome, HUMAN). There a spoof measures the fake-bot path and reports blocks that the real crawler never meets.
3. It remains impersonation, which the project promised not to do.

What the scanner cannot see, it says, and it points to the tools that can: the vendor's AI crawler settings and analytics, Google's and Bing's URL inspection, and the operators' published IP lists.

## Consequences

- Adding, renaming or reclassifying a crawler is one data change with a review of what it does to verdicts. `CONTRIBUTING.md` describes it.
- A site that disallows Google-Extended now gets a warning in A2.2 where it used to pass. A site that disallows only regional or developer crawlers no longer fails A2.2.
- Assistants without a token, such as ChatGPT's cloud browser, Grok and agents in the person's own browser, are documented in the registry and the guide, not scored: robots.txt cannot address them.
- The honest way to let sites recognise the scanner itself is to sign its requests under Web Bot Auth with its own key directory and apply for verified status with bot managers. That is infrastructure work, not a catalog change.
