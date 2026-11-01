# Check audit, 2026-10-31

A review of every check in the catalog against what AI systems actually do when they reach a website in late 2026: which crawlers and fetchers exist and what each one honours, which standards and conventions are real, what the published evidence says about ingestion and citation, what every comparable scanner tests, and how commerce protocols are discovered. The outcome is catalog 0.2.0 and scoring 0.2.0 (this pull request), the per-host history tier ([decision 0009](../decisions/0009-result-storage-tiers.md)) and the rule that the scanner never impersonates another agent ([decision 0010](../decisions/0010-honest-fetch.md)).

Method: five research passes on 2026-10-31, each reading primary sources (vendor crawler pages, IETF and W3C documents, protocol specifications, Google and Microsoft webmaster documentation, the public pages and APIs of other scanners), followed by a check-by-check decision. Where a claim could not be confirmed from a primary source it is marked unverified below and nothing in the catalog rests on it.

## 1. How AI systems reach a site today

**Crawlers come in classes, and the classes behave differently.** Every major operator documents its tokens: OpenAI (GPTBot for training, OAI-SearchBot for search, ChatGPT-User for user requests), Anthropic (ClaudeBot, Claude-SearchBot, Claude-User), Google (Googlebot and Storebot-Google for the index, the robots-only token Google-Extended for Gemini training and grounding, Google-Agent for agents), Apple (Applebot, Applebot-Extended), Meta (meta-externalagent, meta-webindexer, meta-externalfetcher), Amazon (Amazonbot, Amzn-SearchBot, Amzn-User), Perplexity (PerplexityBot, Perplexity-User), Mistral (MistralAI-Training, MistralAI-Index, MistralAI-User), DuckDuckGo (DuckAssistBot), Common Crawl (CCBot) and ByteDance (Bytespider). Three facts drive the catalog:

- Blocking a **training** crawler changes nothing about visibility. Google states that Google-Extended "does not impact a site's inclusion in Google Search" and does not control AI Overviews or AI Mode; OpenAI states that GPTBot and OAI-SearchBot are independent. A training opt-out is a licensing decision.
- Blocking a **search** crawler removes the site from that assistant's answers: OpenAI ("sites that are opted out of OAI-SearchBot will not be shown in ChatGPT search answers"), Anthropic, Perplexity and DuckDuckGo say so in those words. The classic search indexes matter as much: ChatGPT search names Microsoft Bing as a search partner, Microsoft Copilot runs on Bing, Google AI Overviews and AI Mode run on the Google index, and Brave Search (which powers Claude's web search according to Anthropic's subprocessor list, unconfirmed by Anthropic) follows Googlebot's rules.
- **User-triggered fetchers** are documented to fetch regardless of robots.txt because a person asked (OpenAI: "robots.txt rules may not apply"; Perplexity: "generally ignores robots.txt rules"; Google: user-triggered fetchers "generally ignore robots.txt"; Meta: "may bypass"). Anthropic is the exception and honours it. A Disallow for them mostly records intent.

**Agents are identified by signatures, not tokens.** The ChatGPT agent, Google-Agent (in part), DuckAssistBot, Manus and others sign requests with HTTP Message Signatures (Web Bot Auth, now an IETF working-group draft). The key directory at `/.well-known/http-message-signatures-directory` is published by the **bot operator**; a website publishes nothing and verifies at most. A check that asks a store to publish that directory misreads the specification.

**JavaScript rendering is documented for three crawlers only.** Googlebot, Bingbot and Applebot render; Anthropic's fetcher states that it "does not support websites dynamically rendered with JavaScript"; Common Crawl does not execute scripts; the only large-sample measurement (Vercel, December 2024) found no AI crawler rendering. Content and structured data must be in the HTML as served.

**A new shared training token appeared the day before this audit.** The IETF draft `draft-kelley-aipref-training-preference-signal` (30 October 2026) defines a robots.txt group for `User-Agent: __usage_ai-training`; Google and Microsoft announced support for 2027 the same day. Three usage vocabularies now coexist and share no tokens: the IETF `Content-Usage` field (`train-ai`, `ai-use`, `search`), Cloudflare's `Content-Signal` (`ai-train`, `ai-input`, `search`) and RSL's `License:` line. No crawler operator documents honouring Content-Signal, which is on millions of domains by default.

**No assistant documents reading llms.txt.** Google says Search does not use it; a 137,000-domain log study found 97 percent of published files never requested; Lighthouse treats a 404 as not applicable and validates the file only when present.

**Shopping surfaces are feed-driven; product markup is documented input for Google and Bing.** ChatGPT shopping, Microsoft Copilot Checkout and Perplexity's merchant programme ingest pushed feeds; Google Merchant Center reads on-page Product markup for automatic item updates and website crawl, and Bing says Product markup plus IndexNow can replace a feed. Every checkout programme requires the same trust prerequisites: return policy, shipping terms, contact method, privacy policy and terms URLs that resolve.

**Commerce discovery documents.** UCP (Google, Shopify, Etsy, Walmart, Amazon, Microsoft, Meta, Stripe and others; latest 2026-08-25) is the only merchant-side manifest a live platform consumes: `/.well-known/ucp`, JSON, no redirects, `ucp.version`, `ucp.services`, `ucp.payment_handlers`. Shopify serves it for every eligible store together with a `Link: </.well-known/ucp>; rel="ucp"` header and an MCP endpoint at `/api/ucp/mcp`. ACP (OpenAI and Stripe) registers checkout endpoints privately; its discovery document `/.well-known/acp.json` is an unreleased proposal. MCP server cards live at `<endpoint>/server-card`, listed in `/.well-known/ai-catalog.json` (SEP-2127, Final); `/.well-known/mcp` and `/.well-known/mcp.json` were superseded; no host probes any of them yet. The Agent Skills specification defines no web discovery path at all. A2A 1.0 moved its card to `/.well-known/agent-card.json` with eight required fields. x402 and AP2 publish nothing on a storefront.

## 2. What the other scanners test

Twenty-eight tools were examined: Cloudflare's Is It Agent Ready (22 checks, six levels, the best evidence trail, commerce unscored), Shopify's product-page audit (11 equal-weight checks) and its retired 31-check scanner, the Shopware and Agentic Commerce Alliance scanner (32 checks with hard caps and a retrieval-versus-training split), Lumar's conformance linter (36 technologies, absence never a finding), the agentready.org standard with is-agentic.com, Frase, Goodie, Squirrelscan, isagentready.com (82 checkpoints with lifecycle and verify commands), eight open-source scanners, the Lighthouse agentic-browsing audits, the enterprise suites (Semrush, Ahrefs, Conductor, Lumar, Screaming Frog, Botify), the free robots.txt checkers and the GEO audit skills.

The union of their checks is in the research notes; the conclusions that shaped this catalog:

- The serious tools agree on **purpose-classed robots evaluation**: Semrush, Shopware, Squirrelscan, Greadme, the agentready.org standard and others exclude training crawlers from scoring. Tools that penalise a GPTBot block misread the crawlers.
- **Live fetch behaviour** (challenges, 403s, soft blocks) is the one thing robots.txt cannot show and the thing most tools get by impersonating agent user agents. This scanner does not impersonate (section 5).
- **llms.txt** is scored by GEO tools and ignored or linted-only by Cloudflare, Ahrefs, Lumar and Lighthouse. Several tools invent structure rules the proposal does not contain.
- **Invented or dead conventions** appear everywhere: `sitemap.md`, `AGENTS.md` at a web root, `/.well-known/agent-skills/index.json`, `/.well-known/mcp`, `noai` as a directive, `ai.txt`, `og:ai`, `max-snippet:-1` as a requirement, site-side Web Bot Auth directories, security headers as agent readiness.
- Checks **no tool runs** and this catalog now does or already did: policy pages readable by the crawlers behind answers (B4.6), sitemap count versus platform API (B1.7), markup-versus-page parity (B2.6), Shopify's `rel="ucp"` header and agent endpoint (B5.8), UCP hosting rules (B5.1), the shared training token (A2.1), honest 404s (A3.6), sitemap lastmod plausibility (A1.7), Bing's and Apple's answer-exclusion directives (A2.6).
- **History is almost universally paid or absent.** Frase charts health over time, Conductor keeps 60 months, Squirrelscan and agent-ready.dev gate history behind paid tiers; Shopware says two scans months apart are not comparable. This project's history tier is public and records states, not scans.

## 3. Decisions per check

Weights: 1 nice to have, 2 expected, 3 blocking, info reported but never scored.

### Kept as they were

A1.1 robots.txt, A1.2 sitemap, A1.3 product URLs in sitemap, A3.2 server-rendered content, A3.4 canonical, A3.5 main landmark, B1.2 Store API, B1.3 rate limit, B1.4 Store API completeness, B1.6 feed freshness, B1.7 sitemap versus API, B2.1 Product JSON-LD, B2.2 Offer, B2.3 variants, B2.4 shipping and returns markup, B2.5 images, B2.6 markup parity, B3.1 GTIN present, B3.2 GTIN valid, B3.3 brand, B3.4 MPN, B3.5 SKU, B4.2 shipping policy, B4.3 privacy and terms, B4.4 merchant identity, B4.6 policy pages readable, B5.7 cart and guest checkout. Sixteen of these were implemented in this pull request.

### Changed

| Check                       | Before                                                                  | After                                                                                                                               | Why                                                                                                                  |
| --------------------------- | ----------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| A1.4 Link headers           | weight 1, vague relations                                               | weight 1, relations enumerated incl. `ucp` and RSL                                                                                  | Shopify sends `rel="ucp"`; the rest are the relations Cloudflare's scanner and RFC 9727 name.                        |
| A1.5 llms.txt               | weight 2, 404 fails, needs link sections                                | weight 1, 404 skips as not applicable, H1 required, no links warns                                                                  | No consumer among assistants; the proposal requires only the H1; Lighthouse parity.                                  |
| A1.6 llms.txt catalog link  | weight 2                                                                | weight 1                                                                                                                            | Follows A1.5.                                                                                                        |
| A2.1 training crawlers      | weight 2, pass only when all seven named                                | weight 1, pass on the shared token, any named crawler or a usage line; never fails                                                  | Naming twenty bots is not readiness; the shared token is where operators are heading; silence is the only finding.   |
| A2.2 shopping agents        | ChatGPT-User, Claude-User, OAI-SearchBot, Google-Agent, Perplexity-User | the eleven search and assistant crawlers, Googlebot and Bingbot as core                                                             | The old list mixed classes and omitted the indexes that feed most answers. Level 1 gate.                             |
| A2.3 Content Signals        | weight 1, pass when present                                             | info; validates Content-Signal, Content-Usage, RSL and TDMRep syntax                                                                | No operator honours Content-Signal; three vocabularies now exist; presence is not readiness.                         |
| A2.4 WAF challenge          | "fetch with six agent user agents"                                      | classify the scanner's own honest fetches: challenge markers, 402/403/429/451, consent redirects; a blocked policy page alone warns | Impersonation conflicts with the honesty rule and measures the spoof-protection path, not the agent's. Level 1 gate. |
| A2.5 Web Bot Auth directory | site publishes the key directory                                        | retired; id reused for user-triggered fetchers (weight 1)                                                                           | The directory is the bot operator's file; a site publishes nothing.                                                  |
| A2.6 noindex and nosnippet  | noindex, nosnippet, noai, max-snippet:0                                 | adds data-nosnippet coverage, Bing noarchive/nocache/ai-grounding, Apple isAccessibleForFree; noai recorded as a preference only    | Google, Microsoft and Apple document exactly these levers; noai has no documented consumer.                          |
| A3.1 Markdown negotiation   | weight 2                                                                | weight 1, also accepts a `.md` twin or a rel=alternate                                                                              | Coding agents request Markdown, search crawlers do not; three equivalent delivery forms exist.                       |
| A3.3 page weight            | 500 KB and 1.5 s                                                        | 1 MB and 3 s pass, 2 MB and 8 s warn                                                                                                | The only documented limit is Googlebot's 2 MB; the old numbers were invented.                                        |
| A4.1 MCP server card        | `/.well-known/mcp/server-card.json`                                     | ai-catalog.json and `<endpoint>/server-card`; the old path warns                                                                    | SEP-2127 is Final and discourages a well-known card path.                                                            |
| A4.3 OAuth discovery        | standalone                                                              | depends on A4.1, RFC 9728 path-specific metadata first                                                                              | Meaningful only for an endpoint that exists; the MCP specification prescribes the order.                             |
| A4.4 Agent Skills index     | `/.well-known/agent-skills/index.json`                                  | retired; id reused for "MCP endpoint reachable"                                                                                     | The Agent Skills specification defines no web discovery.                                                             |
| A4.5 A2A card               | name, url, skills                                                       | the eight fields of A2A 1.0; legacy agent.json warns                                                                                | Specification moved on.                                                                                              |
| B1.1 WooCommerce detected   | WooCommerce yes or no                                                   | platform detected (WooCommerce, Shopify, WordPress, unknown)                                                                        | Shopify checks need the detection.                                                                                   |
| B1.5 public feed            | weight 2                                                                | weight 1, discovery heuristics spelled out                                                                                          | Platforms ingest pushed feeds; a public copy is a convenience.                                                       |
| B4.1 return policy          | 300 words                                                               | 100 words                                                                                                                           | The threshold was invented; the programmes require a URL that resolves and says something.                           |
| B4.5 contact                | weight 1                                                                | weight 2, Level 4 gate                                                                                                              | Google Merchant Center and UCP require a contact method.                                                             |
| B4.7 security.txt           | weight 1                                                                | info                                                                                                                                | Operational maturity, not agent readiness.                                                                           |
| B5.1 UCP manifest           | version and capabilities array                                          | `ucp.version`, `services`, `payment_handlers`; hosting rules (no redirect, JSON, cache)                                             | Matches the 2026-08-25 profile shape and Google's publishing rules.                                                  |
| B5.2 UCP capabilities       | capabilities list                                                       | checkout capability plus a payment handler; endpoint probed                                                                         | What an agent needs to transact.                                                                                     |
| B5.3 ACP endpoint           | "OpenAPI or discovery link"                                             | `/.well-known/acp.json` proposal, weight 1                                                                                          | The only public trace of an ACP integration.                                                                         |
| B5.4 ACP feed fields        | weight 2                                                                | weight 1, exact field names of the current feed specification                                                                       | Field names were wrong; feeds are rarely public.                                                                     |

### Retired

- **A2.5 Web Bot Auth key directory** (misreads the specification; the id now holds the user-triggered fetcher check).
- **A4.4 Agent Skills index** (invented path; the id now holds the MCP reachability check).
- **B3.6 Identity resolvable per channel**: its rule collapsed to "GTIN, or brand plus MPN", which B3.1, B3.2, B3.4 and B3.3 already express; the Level 3 gate now reads B3.1 or B3.4, B3.2 or B3.4, and B3.3.
- **B5.5 Payment-handler signals** (script sniffing is a weak proxy; UCP's `payment_handlers` is the real signal).
- **B5.6 AP2 or x402 signals** (nothing a storefront publishes).

### Added

- **A1.7 Sitemap lastmod present and plausible** (weight 1): Bing calls lastmod a key signal for AI answers; Google uses it when accurate.
- **A2.5 User-triggered fetchers are not disallowed** (weight 1): reported honestly as intent, since most ignore robots.txt.
- **A3.6 Unknown URLs answer 404** (weight 1): a soft 404 makes an agent read a non-existent page as content; a MUST in the agentready.org standard.
- **A4.4 MCP endpoint reachable** (weight 1): a card that points nowhere is worse than none.
- **A4.6 WebMCP tool declarations** (info): a Chrome origin trial, detectable from the HTML, not yet a readiness signal.
- **B1.8 Shopify products.json readable** (weight 3, Shopify only): the Shopify catalog as data; a Level 2 alternative.
- **B5.8 Shopify agentic storefront active** (weight 2, Shopify only): the `rel="ucp"` header and `/api/ucp/mcp`.

### Levels (scoring 0.2.0)

| Level                   | Gate                                                   |
| ----------------------- | ------------------------------------------------------ |
| 1 Crawlable             | A1.1, A2.2, A2.4, A3.2                                 |
| 2 Readable catalog      | Level 1 and (A1.3 or B1.2 or B1.8 or B1.5), B2.1, B2.2 |
| 3 Identifiable products | Level 2 and (B3.1 or B3.4), (B3.2 or B3.4), B3.3       |
| 4 Trusted merchant      | Level 3 and B4.1, B4.2, B4.3, B4.5                     |
| 5 Transactable          | Level 4 and (B5.1 or B5.3)                             |

Level 1 now requires an unchallenged honest fetch, because a store that challenges every unverified client is unreachable for every agent that is not on an allow list. Level 2 no longer requires a platform API or feed: a store whose product pages are enumerable and carry complete markup is readable. Level 5 still means "the public prerequisites are in place", never "a checkout was exercised".

## 4. What this scanner refuses to test, and why

- **Training opt-outs as a penalty.** A licensing decision.
- **Agent impersonation.** See section 5.
- **llms.txt presence as a score, llms-full.txt, AGENTS.md at a web root, `sitemap.md`, `ai.txt`, `og:ai`, custom AI meta tags.** No consumer, or invented.
- **`noai` and `noimageai` as directives.** Recorded as a declared preference; no major operator documents honouring them.
- **Site-side Web Bot Auth directories, `/.well-known/mcp`, `/.well-known/agent-skills`, NLWeb probes, x402, AP2, DNS-based agent discovery.** Misread, superseded, or nothing a storefront publishes.
- **Blind IndexNow key detection.** The key is the file name; nothing publishes it.
- **FAQPage, HowTo, speakable, author schema as AI signals; title and description lengths; word-count gates; Core Web Vitals; HTTP/2.** No primary evidence ties them to AI ingestion or citation; Google removed the FAQ rich result in 2026.
- **Security headers as agent readiness.** Unrelated.
- **Claims that a checkout works, that a feed was accepted, that a block is enforced for a user-triggered fetcher, or that a site is in any index.** Not observable from public signals; the result object says `not_implemented` or the report says so in words.

## 5. The scanner identifies itself and only itself

Every request carries `AgenticReadinessScanner/<version> (+repository URL)`. The previous catalog planned to fetch one product page under six agent user-agent strings. That was dropped for three reasons: it is impersonation, which the project's honesty rule forbids; bot-management products verify the large crawlers by IP range or signature and treat a spoofed GPTBot from an unknown address as an attacker, so the probe measures the spoof-protection path rather than what GPTBot experiences; and what the scanner's own honest fetch meets is exactly what every unverified agent meets. A2.4 therefore classifies the responses the scan already made and says in its message that verified crawlers may be treated differently. Recorded as [decision 0010](../decisions/0010-honest-fetch.md).

## 6. Result storage

The previous design kept one row per scan with the full result JSON, purged after thirty days, plus a last-state row per host. Progress over time was not derivable after the purge and expensive before it. The new design ([decision 0009](../decisions/0009-result-storage-tiers.md)) keeps three tiers: full results with evidence (purged), one row per **distinct state** per host (never purged; a rescan that changes nothing extends the row), and the last-state index. The comparable core of a result is the level, both scores, the score per group and the verdict and skip reason of every check, under one catalog and scoring version. It is exposed at `/h/<host>` (page with trend chart and per-state changes), `/h/<host>.json`, in a "since the previous state" block on every report, through the MCP tool `get_history`, through the owner export, and the CLI gained `diff` for two saved reports (exit code 3 on change). Check ids are therefore treated as stable identifiers: retired ids are not reused for unrelated meanings except where noted above (A2.5, A4.4), and those two were never implemented, so no history row carries a verdict for the old meaning.

## 7. Coverage after this pull request

|        | Checks | Implemented                                | Reported as not implemented |
| ------ | ------ | ------------------------------------------ | --------------------------- |
| Before | 55     | 19                                         | 36                          |
| After  | 57     | see the table in [checks.md](../checks.md) | the remainder, honestly     |

The recorded WooCommerce store fixture reaches Level 4 with every implemented check passing; Level 5 needs a UCP profile or ACP document, which the fixture now also carries once those checks land. A recorded Shopify store fixture exercises the Shopify-only checks.

## 8. Sources

Primary sources consulted for this audit (all fetched on 2026-10-31): the crawler pages of OpenAI, Anthropic, Google, Microsoft, Apple, Meta, Amazon, Perplexity, Mistral, DuckDuckGo and Common Crawl; RFC 9309, 8288, 9110, 9116, 9727, 9728, 8414, 7763; the IETF aipref and webbotauth drafts and `draft-kelley-aipref-training-preference-signal-00`; the Content Signals Policy, RSL 1.0 and TDMRep; Google's documentation on AI features, robots meta tags, sitemaps, Googlebot limits, soft 404s, interstitials and Merchant Center requirements; Bing's documentation on crawlers, meta tags, sitemaps in AI search and the October 2026 training and grounding preferences; Cloudflare's documentation on challenge detection, AI crawl control, Markdown for agents and Web Bot Auth; the MCP specification 2026-07-28 and SEP-2127; the A2A 1.0 specification; the Agent Skills specification; UCP 2026-08-25 and Google's UCP merchant guides; the ACP repository and OpenAI's commerce specifications; Shopify's agentic storefront and agent checkout documentation; the WooCommerce Store API documentation; Vercel's crawler study; Ahrefs' llms.txt and schema studies; and the public pages, methodologies or APIs of the scanners listed in section 2. The spec column of [checks.md](../checks.md) carries the URL each check rests on.
