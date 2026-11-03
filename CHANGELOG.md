# Changelog

All notable changes to this project are documented here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project uses [Semantic Versioning](https://semver.org/).

## [Unreleased]

### Added

- **Legal signals**, a new category of 24 checks in six groups: seller identity and complaints, privacy notices and choices, withdrawal, returns and cancellation, accessibility, product and price information, and AI transparency and content rights. Each check names the laws it relates to (a dated registry with official links across the EU and national examples, the UK, Switzerland, the United States and California, Canada, Australia, Brazil, Argentina, Chile, Colombia and Peru) and runs only for the markets a store appears to sell to, detected from its domain, page language, hreflang, currency, addresses and register numbers (with check digits), or chosen with `--markets`. They are never scored and never part of the level; the hosted report links them on `/sites/<host>/legal` and `/r/<id>/legal` (also `.json` and `.md`), which are noindex, disallowed in robots.txt and kept out of the sitemap and the readiness exports. Every rendering opens with the notice that this is a technical evaluation, not legal advice. Each check has a knowledge-base article under `/knowledge-base/legal-signals`. See decision 0015.
- A browser regression suite for the hosted pages (`pnpm test:layout`, run in CI and by `pnpm check`). It automates the invariants of the 2026-11-03 UI audit against a fixture-backed server: no page-level horizontal scroll, catalog IDs on one unclipped line, 44px controls and the shared shell on every page family at 320, 375, 768, 1024 and 1440px in both themes and at 200% text; the scan console handing over to its report with the shared view-transition names, the arrival playing once and never under reduced motion; map cells linking to their checks; the knowledge-base filter, chips and `/` shortcut; the remembered theme; and the no-JavaScript homepage.

- Readable `/sites/<host>` profiles for root URLs, with separate subdomain identities, retained immutable scan snapshots and history after full report expiry. Path/query scans return browser-only reports without result, history, target, monitoring or progress storage. One atomic host reservation limits new scans to one per minute across paths, HTTP, MCP and monitoring; root cache hits replay safely, denied scans return retry guidance and failures consume the minute. Redirected roots retain their submitted identity for rescan actions. Scope, privacy and legacy behavior are documented and regression-tested.

- Server-rendered canonical, Open Graph and X metadata with branded 1200 × 630 PNG previews for the homepage, knowledge base and hosted reports. Connected schema.org entities describe the app, articles and actual stored report scores, with JSON exports for agents. Active reports now allow search indexing and assistant/social crawling; JSON and Markdown exports point to canonical HTML without duplicate indexing. Listed training crawlers retain their report restriction. Build-only image generation, regression coverage and a sharing-metadata guide document the policy and maintenance.

- Knowledge base navigation: a journey rail of the nine sections (find, get in, read, connect, catalog, products, identify, trust, buy) with the current one lit, a strip of every check as a cell with the current check and section highlighted, a sidebar with the section's checks and the article outline that follows your scroll position, a reading progress bar, previous and next across sections, and on the index a filter by text and priority (press `/`).
- For agents: `/knowledge-base.json` lists every section and check with priority, level gate and URLs; section pages are Markdown too; Markdown articles open with YAML front matter (canonical URL, check id, priority, level gate); HTML and Markdown answers carry `Link` headers to each other; article sections are `<section>` elements; and the MCP server answers `explain_check` with the article.

- A knowledge base on the hosted app: an index at `/knowledge-base` (first published at `/knowledge`, which now redirects), a page per section and one article per check (64) that explains what the check looks at, why it matters to AI agents, exactly how the scanner decides, how to fix it on WordPress and WooCommerce, Shopify or any other stack, how to verify the fix, common mistakes and an FAQ. The page adds the check's priority, the level it gates, its dependencies, the fix with the prompt for a coding agent, and its specifications from the catalog. Every page is also Markdown (append `.md` or send `Accept: text/markdown`), carries schema.org TechArticle, FAQPage and BreadcrumbList data and a canonical URL, and is listed in the new `/sitemap.xml` and in `/llms.txt`; `/llms-full.txt` holds every article in one file. `/knowledge-base/<check id>` redirects to the article. Articles live in `packages/catalog/knowledge` and are validated by the catalog build (see `docs/knowledge-base.md`). The home page's section cards link to their section of the knowledge base.

- A check map on every HTML report: one cell per check, grouped by section with the section score, coloured by verdict and linked to the check (opening its section). Arriving from the scan console, the console's grid and radar morph into the check map and the level badge (cross-document view transitions where the browser supports them), the cells pop in as a wave, the level badge bounces with a burst of confetti, and the map says how long the scan took. The animation plays once per scan, never on reload or a shared link, and respects reduced motion. Deep links to a check (`/r/<id>#B2.2`) open its section and scroll to it.

### Changed

- Scores never stand on a sliver of the catalog (scoring 0.5.0). Each dimension records the share of its applicable weight the scan answered (`scores.coverage`); below half, commerce and group scores are `null` and every report says "Incomplete" with the share instead of printing a number. A slow store whose scan ran out of time after one passing commerce check used to read 100 for commerce. Checks now run level gates and blocking checks first, so a short time budget leaves optional probes unanswered rather than the gates, and a dependent of a check the budget never reached is reported as unanswered, not as blocked by a failure.
- A navigation button is never taken for a policy link: "Return to shop" no longer counts as a returns-policy label, and a footer link whose path names the policy document (`/return-policy/`) ranks above a stray word in a body button.

- Removed the homepage animation pause control and its saved preference; background signals continue to respect OS reduced motion and active scan state. The hero copy now reads “Built WooCommerce first. Works on any store.”

- Shared Signal Network design across the homepage, reports, knowledge base, history, monitoring and error pages: full-width Woo-purple headers, an uppercase lime-accented homepage headline, responsive scan controls, an icon theme toggle with dark mode by default, accessible links and focus states, and background signals that respect reduced motion. Offline reports retain the same self-contained design and the existing progress-to-report handoff; check maps add verdict symbols and larger targets.

- Hosts are stored without a leading `www.`: `www.example.com` and `example.com` share one cooldown, one history, one badge and one monitoring subscription. Other subdomains keep their own key. Rows stored before are moved to the bare host on first use, `/h/www.example.com` redirects to `/h/example.com`, and the scan still fetches the URL that was given.
- The footer reads "An experiment by Matthias Reinholz" with links to the knowledge base and the source, without the licence line, and the home page no longer repeats that nothing requires credentials.

### Fixed

- UI consistency across page types: catalog IDs and badges stay on one line, forms adapt to their actual available width, tablet score cards balance, and panels, text, controls and code examples share consistent sizing. Narrow and enlarged-text layouts reflow result/knowledge rows and level summaries; hover/focus no longer overlaps map cells or gets held by completed arrival animations. Monitoring dialogs keep their close action and fields usable, and wide examples/tables have keyboard-accessible scroll regions.

- Patched the build-only social-image dependency `fflate` from 0.7.3 to 0.7.5 through a narrow override, resolving GHSA-px8p-9vwx-vf98 while preserving generated image output.

- The homepage headline no longer paints a purple rectangle over the animated network. A shared feathered network mask and lower intensity on narrow screens preserve text contrast without covering the decoration; compact hero metadata and level descriptions retain readable line lengths.

## [0.9.0] - 2026-11-02

### Fixed

- A store that rate-limits the scanner while the target is being resolved (sitemaps, product discovery, Shopify's fallback policy pages) now gets a report whose remaining checks say they were not run because the store answered 429, instead of an internal error. Unexpected failures of a streamed scan name the error.

### Added

- A live scan console on the home page: the scan streams from `POST /api/scan/stream` as server-sent events and the page animates what actually happens, the five phases, one grid cell and one radar blip per check verdict, the request counter against the budget, and a terminal log, then reveals the level and opens the report. A result reused within the cooldown is replayed from its stored verdicts. Spacefast holds streamed responses back until they end, so the scan request also writes its events to a `scan_progress` table and the page polls `GET /api/scan/progress/<token>` every 600 ms; events are numbered so the stream and the poll never apply one twice, and the cleanup cron removes progress older than an hour. Without JavaScript the form posts as before. The engine gains `ScanOptions.onProgress` (phase, target and check events with running request count and elapsed time).

## [0.8.0] - 2026-11-02

### Changed

- The README and the home page point at the published packages: `npx @agentic-readiness/cli scan <url>`, `npx -y @agentic-readiness/cli mcp` for local coding agents, and `@agentic-readiness/core` as a library.

## [0.7.0] - 2026-11-02

### Changed

- Two packages are published instead of five ([decision 0013](docs/decisions/0013-two-published-packages.md)): `@agentic-readiness/cli` (the command line with the local MCP server inside, every workspace package bundled in) and `@agentic-readiness/core` (the engine with the catalog and the visual system bundled in and their types inlined). `catalog`, `ui` and `mcp` are private workspace packages; the release packs and publishes the two. The home page no longer advertises `npx` until the first publish. The release workflow publishes the attested tarballs through npm trusted publishing (OIDC, repository variable `NPM_TRUSTED_PUBLISHING`) and uses the `NPM_TOKEN` secret only for a package's first publish.

## [0.6.0] - 2026-11-02

### Changed

- On a multi-market site the scan samples the market the owner typed: the product sitemap whose name carries the input URL's locale (ikea.com/us/en/ → `prod-en-US_1.xml`, not the first child in the index) is fetched first, product URLs under that path win, and the report warns when the sample had to come from another market.

## [0.5.0] - 2026-11-01

### Added

- A wall-clock budget per scan (`ScanOptions.deadlineMs`, hosted default `SCAN_DEADLINE_MS` = 24 s under the platform's 30 s request limit): once it is used up the remaining checks are skipped with that reason and the report is still produced, instead of the platform answering with an error for a slow store.

- **Reports lead with what to do** ([decision 0012](docs/decisions/0012-priorities-and-honest-non-answers.md), [the report and accuracy audit](docs/audits/2026-11-01-report-and-accuracy-audit.md)): open findings are ordered by the level they unlock, then by tier (blocking, expected, nice to have, informational), then fail before warn, and every surface renders the same list; summary lines count findings per tier and split skips into "did not apply" and "could not run"; groups made only of optional checks are tagged and their score muted; every report ends with what the scan did and did not do (pages read, no JavaScript, no sign-in, no impersonation).
- A refused home page (403, 429, a bot-management challenge) now produces a Level 0 report that names the product behind the refusal (Cloudflare, Akamai, DataDome, Vercel, Imperva, HUMAN, AWS WAF) and evaluates robots.txt and the sitemap, instead of aborting with "not reachable".
- The fetcher inflates gzip sitemaps, keeps at least 150 ms between requests, retries once on a dropped connection or a short `Retry-After`, and the scan lists every request that failed and every 429 in its warnings. Scan option `minIntervalMs`.
- Store detection reads cart vocabulary in a dozen languages and Product JSON-LD; product sitemap names from large platforms (`prod-<locale>_N.xml`, `products_N.xml`, `artikel`) and more product URL forms are recognised; a sitemap larger than the 2 MB the scanner reads keeps its complete entries before the cut; when no URL matches a product pattern, a few linked pages are fetched and kept as product pages when they carry Product JSON-LD or an add-to-cart control; child sitemaps that fail to parse are named in the warnings. After a 429 the fetcher backs off (one second, then two) and stops after three persistent ones, and the remaining checks say so. A headless Shopify storefront is recognised and the Shopify-only checks do not apply to it.
- **Catalog 0.4.0 and scoring 0.4.0.** Level 2 accepts Shopify's UCP catalog (B5.8) as a readable catalog; B5.8 weighs 3 and B1.8 (`products.json`, undocumented and rate-limited) weighs 2; A3.5 (main landmark) is informational; content sites are not scored on product URLs in their sitemap (profiles can exclude checks); `next_gate` lists only alternatives the profile includes. Texts and citations corrected from a research pass over every vendor programme: Google's merchant listing rules (Offer, price above zero, `priceValidUntil`, required name and image, Organization-level return and shipping policies, 500 px images from 2027-01-31), Lighthouse's llms.txt rule, the timing of the shared training token, Bing's 2027 dates, Amazon's reading of `noarchive`, OpenAI's feed fields, UCP's payment handler fields and its 2026-08-25 key change, the MCP 404 rule, Shopify's agentic storefront defaults.

### Changed

- A page the scanner did not read is never scored: content checks judge only sampled pages that answered 2xx and say which did not; a refused policy page is a note on A2.4 and a B4.6 finding instead of a Level 0; rate-limited probes are inconclusive; absent optional files (usage-preference signals, WebMCP, security.txt) are not applicable.
- Policy, contact and listing links are chosen by label quality, footer position and path, as whole words with their compounds, never from product, listing or account URLs; a policy link that leads to a product page fails the policy check with that reason; on Shopify the platform's own policy page replaces a pick matched by path alone. Shopify's store root is no longer counted as a product URL; a headless Shopify storefront is recognised and the Shopify-only checks do not apply to it.
- ProductGroup variants carry the offers, GTINs, MPNs and SKUs that B2.2, B2.3, B2.4, B3.1 and B3.4 read; a GTIN counts only when it is 8, 12, 13 or 14 digits; B2.5 matches images by path across `srcset` and `<picture>`, prefers one with alt text and treats a failed HEAD as inconclusive; Organization-level return and shipping markup satisfies B2.4.
- Messages name the thing: the image and its issue, which of brand and MPN is missing, the contact pages found, the from and to of a redirect, the element that precedes the main landmark, the sitemaps read, the reason a page was not fetched. The head check ignores `<title>` inside inline SVG. The Markdown report prints the working rules for coding agents once; the per-finding brief stays in the HTML report and the MCP `get_fix` tool.

## [0.4.0] - 2026-11-01

### Added

- **Catalog 0.3.0 and scoring 0.3.0** after an audit of the conventional technical SEO that AI answer products inherit from the indexes they run on ([docs/audits/2026-11-01-technical-seo-audit.md](docs/audits/2026-11-01-technical-seo-audit.md), [decision 0011](docs/decisions/0011-technical-seo-scope.md)). New checks: A1.8 listing pages link to products and further pages, A2.7 render resources not blocked by robots.txt, A3.7 product URLs answer directly over HTTPS (with http:// and host-variant consolidation), A3.8 title and description on every page, A3.9 conditional requests supported, A3.10 mobile viewport declared, A3.11 document head is well-formed (metadata after a head-breaking element, meta refresh, doctype, charset).
- A position-aware head scanner (`parsers/head.ts`) and HTML parser helpers for the root `lang`, external scripts, stylesheets and headings; fixtures can now record redirected requests (`final_url`, `redirects`).

### Changed

- A2.6 fails on `nosnippet`, `max-snippet:0` and `data-nosnippet` around the main content (Google builds AI Overviews and AI Mode from snippet-eligible pages only; Apple generates no web answer without one), recognises Bing's `ai-grounding:disallowextended` and the `Bingbot:`-prefixed header form, has weight 3 and gates Level 2.
- A3.3 fails at Googlebot's 2 MB document cutoff instead of warning; A3.4 judges canonical correctness (HTML and Link header, absolute, single, same origin, HTTPS, self-referencing) instead of presence.
- The recorded stores carry viewport tags, ETags with 304 answers, host-variant redirects and a listing page with pagination.

## [0.3.0] - 2026-11-01

### Added

- **Catalog 0.2.0 and scoring 0.2.0** after a research audit of every check against the documented crawlers, the current standards and drafts, the published evidence on AI ingestion and every comparable scanner ([docs/audits/2026-10-31-check-audit.md](docs/audits/2026-10-31-check-audit.md)). New checks: A1.7 sitemap lastmod, A2.5 user-triggered fetchers (replacing the misread Web Bot Auth check), A3.6 honest 404s, A4.4 MCP endpoint reachable (replacing the invented Agent Skills index), A4.6 WebMCP declarations (informational), B1.8 Shopify `products.json`, B5.8 Shopify agentic storefront. Retired: B3.6 per-channel identity (folded into B3.1 to B3.4), B5.5 payment-handler signals, B5.6 x402 and AP2 signals. The `shopify` requirement joins `woocommerce` and `products`.
- Every catalog check is implemented (38 new implementations: A1.4, A1.7, A2.3 to A2.5, A3.1, A3.3 to A3.6, A4.1 to A4.6, B1.3 to B1.8, B2.3 to B2.6, B3.3 to B3.5, B4.4 to B4.6, B5.1 to B5.4, B5.7, B5.8), each with per-branch tests; new parsers for Link headers, product feeds, prices, usage-preference signals and sitemap lastmod; the recorded WooCommerce store reaches Level 5 and a recorded Shopify store exercises the Shopify checks. MCP endpoints are probed with a read-only JSON-RPC `server/discover` POST, the only request the scanner sends with a body.
- **History per host** ([decision 0009](docs/decisions/0009-result-storage-tiers.md)): a `scan_history` table with one row per distinct state (level, scores, score per group, verdict and skip reason per check, catalog and scoring version), never purged; `/h/<host>` with a trend chart and what changed between states, `/h/<host>.json`, a "since the previous state" block on every report, the MCP tool `get_history`, and the owner export `/internal/export/history.json?host=`.
- CLI `diff <before.json> <after.json>` (`--format text|json`), exit code 3 when anything changed.
- The hosted app serves its MCP server card at `/mcp/server-card` and lists it in `/.well-known/ai-catalog.json` (the community path keeps answering), and its robots.txt states a shared training decision (`__usage_ai-training`) and names the crawler classes.
- The fixture fetcher answers per request method and headers and caches like the production fetcher.

### Changed

- `@agentic-readiness/ui` is a version surface of the release script and a packed release asset, since `@agentic-readiness/core` depends on it.
- Crawler tokens are evaluated by class ([packages/core/src/checks/crawlers.ts](packages/core/src/checks/crawlers.ts)): A2.1 passes on any stated training decision and never fails; A2.2 evaluates the eleven search and assistant crawlers with Googlebot and Bingbot as core and is a Level 1 gate together with A2.4; A2.6 adds `data-nosnippet`, Bing's `noarchive`, `nocache` and `ai-grounding:disallow` and Apple's `isAccessibleForFree`, and records `noai` as a preference only; A1.5 skips when llms.txt is absent and requires only the H1 the proposal requires; A3.1 accepts a `.md` twin or a Markdown alternate; A3.3 thresholds follow Googlebot's 2 MB limit; A4.1, A4.3, A4.5, B5.1 to B5.4 follow the current MCP, A2A, UCP and ACP documents; B4.5 is a Level 4 gate; B4.7 is informational. Levels: see [docs/scoring.md](docs/scoring.md).
- The scanner never impersonates another agent ([decision 0010](docs/decisions/0010-honest-fetch.md)); the security model says so.
- A2.4 fails only when the home page, robots.txt or a product page is blocked; a blocked policy page alone warns. The resolver no longer picks policy pages from the account, login, cart or checkout areas, which answer with login walls (found on the first live scan after deployment: woocommerce.com linked its support form under `/my-account/`, and the 403 there made a reachable store "Not reachable").
- The robots.txt parser keeps Content-Signal, Content-Usage and License lines with their group; `ResultSnapshot` carries group scores and skip reasons; a check whose dependency did not apply is itself not applicable instead of "dependency failed"; Shopify policy pages are found at their fixed paths when the footer does not link them.

- The visual system moves to a new `packages/ui` built on the app-base UI standard's framework layer: Tailwind CSS 3.4 with the shadcn token contract, class recipes transcribed from its primitives (button, badge, card, input, select, alert, textarea), lucide icons and self-hosted Inter, compiled at build time and inlined so the CLI's HTML report stays one file. The report and the hosted pages are re-rendered on it; dark stays the default theme, with a bright blue primary in both themes ([decision 0008](docs/decisions/0008-ui-standard.md)). No React or app framework.
- The hosted app serves the latin subset of Inter under `/fonts` and the development server serves `public/` and the fonts like production.

### Fixed

- `pnpm scan <url>` at the repository root runs the CLI again (it invoked a bin that is not linked inside its own package and omitted the `scan` command).

## [0.2.0] - 2026-10-31

### Added

- Per-section scores: `scores.groups` in the result object (one weighted score per catalog group, null when nothing applied), shown in the HTML and Markdown reports.
- Composed agent briefs: every fix prompt is wrapped in context (scanner, target, observation, specs) and working rules (investigate first, durable fix over patch, verify) via `composeAgentPrompt`; used by the HTML and Markdown reports and the MCP `get_fix` tool (`agent_brief`).
- Dark theme by default with a light theme toggle, remembered per browser; shared visual system (`html-theme.ts`) for the report and the hosted pages, with a blue accent.
- Monitoring: a report offers to rescan the host weekly and email when the level, a score or a check result changes. Double opt-in, hashed tokens, one-click unsubscribe, a daily cron that processes due subscriptions, and a `Mailer` interface with Brevo (configured) and Resend adapters (`MAIL_PROVIDER`, `MAIL_API_KEY`, `MAIL_FROM`). Result diffing lives in core (`diffSnapshots`).
- A durable `targets` registry of every host scanned (first and last seen, count, last level and scores) that is never purged, plus token-protected owner exports at `/internal/export/targets.json` and `/internal/export/monitors.json` (`ADMIN_TOKEN`).

### Changed (scoring 0.1.1, catalog 0.1.3)

- Level gates are satisfied vacuously only for checks outside the profile's catalog. A check the profile includes but that could not run on the target (no product pages found, dependency failed, not implemented) now blocks the gate, so a store without discoverable product pages stays at Level 0 instead of being waved through Level 2. Product-page checks declare a `products` requirement; content sites declare it unmet.

### Security

- The scanner honours robots.txt for its own user agent (`RobotsGatedFetcher`); refused URLs are listed in the scan warnings.
- Per-host cooldown applies regardless of profile overrides; parallel submissions share one scan; at most four scans run per isolate.
- Two check regexes with polynomial backtracking (price text, shipping details) rewritten with bounded repetitions on capped text; robots.txt wildcard matching is a linear scan instead of a regex.
- Fetcher: a failing body stream becomes a failed response instead of an unhandled rejection; sitemap entries are resolved and limited to the target origin; Store API payloads are validated before use.
- Hosted app: `Vary: Accept` on negotiated report URLs (the live CDN was serving HTML to Markdown clients); an error handler that never leaks messages; numeric environment variables validated at startup; export `limit` guarded; constant-time admin token comparison.
- Monitoring: a mail provider failure affects one subscriber only; rows are claimed before work; confirmation emails capped at five per address per day; pending requests purged after 48 hours; monitoring stays off unless `APP_BASE_URL` is explicit; a ten-minute floor between cron runs per isolate.
- Markdown report fences survive backticks in target text; the observation line in agent briefs is sanitised.

### Changed

- Catalog 0.1.1: fix texts reworded (placeholders use example.com; B1.4, B2.5 and B3.6 no longer refer to a plugin or a report table that does not exist).
- Catalog 0.1.2: redirected spec URLs updated (OpenAI crawler and product feed docs, Google's crawler list, Agent Skills, x402, ACP); A3.5 cites the WAI-ARIA 1.2 landmark roles and B3.6 Meta's catalog field reference; A4.1 cites SEP-2127 and says the server-card path is a convention this scanner adopts; the agent prompts of A1.3, A3.1, B2.3, B3.1, B3.3, B3.5 and B4.3 are platform-neutral with a WordPress/WooCommerce clause.
- A1.1 warns on every 4xx robots.txt (RFC 9309: unavailable means allow all) and fails only on 5xx and network errors. The fetcher decodes bodies with the declared charset, falling back to UTF-8. `applies` in the result object is documented as false exactly for `not_applicable`, and B2.2 and B3.2 skip that way without product pages.
- Test coverage: `mapFetcher`, `targetFor` and `runCheck` on `@agentic-readiness/core/testing` for per-branch check tests; tests for the runner, the HTML, JSON-LD and security.txt parsers, the sampler, the SQL stores (through an in-memory fake), the CLI formats and exit codes, and the MCP tools. The CLI rejects an unknown `--profile` as a usage error.
- Hosted app: `app.ts` split into `scan-service.ts`, `routes/report.ts` and `routes/internal.ts`; the SQL stores share a base class and validate rows; the app's TypeScript project no longer has Node types, so Node-only globals fail the build there.
- The companion plugin is dropped ([decision 0007](docs/decisions/0007-no-companion-plugin.md)): its contract document, the `PLUGIN_URL` variable and the plugin link on WooCommerce reports are removed; `auto_fix` now means "mechanical fix" and the docs column reads "Mechanical".
- Documentation corrected to match the code: release status and the current level ceiling (2) in the README, CLI run from a checkout until the packages are on npm, secrets and workflow facts in SECURITY.md and the security model, robots.txt handling stated honestly, hosting notes recorded as verified.
- Hosted app: `robots.txt` declares explicit decisions for AI training crawlers and keeps `Content-Signal` inside the group; `security.txt` expires within a year and links the policy; `llms.txt` no longer links the POST-only API as a page; the badge label reads "agentic readiness"; the report footer carries the source link, licence and disclaimer.
- The HTML report groups checks into collapsed, colour-coded sections with a score each and an expand-all control; fix details carry a copy button for the agent brief.
- Home page form and layout rebuilt on the shared theme (consistent spacing, custom select chevron, focus states).

## [0.1.0] - 2026-10-31

### Added

- Monorepo scaffold: catalog, core engine, MCP server package, CLI, hosted Hono app for Spacefast Functions, recorded store fixtures, CI and release workflows.
- Deployment through Spacefast's GitHub integration, configured in the repository-root `sf.jsonc`; GitHub Actions holds no Spacefast credentials.
- Security headers on every worker response and RFC 8288 discovery links (`llms.txt`, MCP server card) on the home page, set by the app because platform header rules do not reach worker responses.
- Catalog of 55 checks in 9 groups with levels, profiles, fixes in three forms, and a versioned result schema exported as JSON Schema.
- Implemented checks: A1.1, A1.2, A1.3, A1.5, A1.6, A2.1, A2.2, A2.6, A3.2, B1.1, B1.2, B2.1, B2.2, B3.1, B3.2, B4.1, B4.2, B4.3, B4.7.
- Reporters: JSON, Markdown, HTML, SVG badge.
- Hosted app: scan form, JSON API, report in three formats, badge, llms.txt, MCP server card, Streamable HTTP MCP endpoint, result storage in the Space database, retention cron.
