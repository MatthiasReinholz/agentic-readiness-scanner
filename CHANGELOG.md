# Changelog

All notable changes to this project are documented here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project uses [Semantic Versioning](https://semver.org/).

## [Unreleased]

## [0.15.0] - 2026-11-04

### Changed

- **Levels follow what agent checkout programmes require** (catalog 0.10.0, scoring 0.8.0). Level 3 is now Trusted merchant (return, shipping, privacy and terms pages and a contact) and Level 4 Identifiable products. Every checkout programme asks for the policies before it lists a store; none requires a GTIN.
- **A warning that is about intent no longer means "Not reachable".** A missing robots.txt, or one served as an HTML page, means "allow all" (RFC 9309), and one minor crawler blocked still leaves the site reachable. These warnings on A1.1 and A2.2 now meet the Level 1 gate (`warn_meets_gate` in the catalog). Every other warning still holds the level back.
- **The scanner never counts a check it could not answer as a failure.** A rate limit, a gateway error or no response is now inconclusive in A1.1, A1.5, B1.2, B1.8 and B5.1. A refused or rate-limited policy page is inconclusive in B4.1 and B4.2. Checks that depend on an inconclusive check say "not evaluated", not "did not pass". When only unanswered checks stand before the next level, the result carries `level.undetermined` and the report says the level is not decided.
- **Absent optional files are not scored:** A1.4 (Link headers), A4.1 (MCP server card), A4.2 (API catalog) and A4.5 (A2A agent card) are not applicable when nothing is published. A broken file still fails. A4.3 no longer fails an MCP endpoint that does not ask for authorization, which the MCP specification makes optional.
- **A1.6, A3.10 and B1.6 are informational.** No agent documents reading the links in llms.txt or the viewport tag, or a freshness threshold for feeds.

### Fixed

- **Holding pages and redirects to another site are not scored as the store.** A maintenance or catch-all page that the site serves for every URL, a challenge page served with HTTP 200, and a redirect to another site are now reported as "not evaluated", and the report says why. A redirect to a consent or region gate is a finding (A2.4 warns). When rate limits stop product discovery, the product checks are "not evaluated" too, and an undecided Level 0 reads "Not decided yet" instead of "Not reachable".
- **A2.4 decides from the pages agents need:** the home page, robots.txt and product pages. A 429 only on product pages, late in the scan, is inconclusive.
- **Sitemap discovery follows the platform** (WordPress paths only on WordPress), stops at the first rate limit or server error, and A1.2 and A1.3 skip as inconclusive when it stopped early.
- **Applebot follows the Googlebot group** when robots.txt has no Applebot group, as Apple documents.
- **Stable product samples:** pages are picked by a hash of the URL, so a new product changes a store's sample by at most one page. Rescans compare the same products.
- **Fewer wasted requests:** a URL already met as a redirect hop is served from cache, and a timeout cut short by a scan step is retried in the next step instead of being recorded as a failure.

- **An invalid GTIN can no longer pass the identity level.** B3.2 now fails on a GTIN with a wrong check digit or a prefix Google rejects (02, 04 and 2 for in-store and internal numbers, 05, 98 and 99 for coupons), and the level needs it to pass. It passes when no product declares a GTIN, so brand plus part number still identifies products without one.
- **Level 5 needs a complete checkout declaration.** B5.2 no longer reads a UCP profile that lists only catalog capabilities as a checkout. B5.3 requires the fields the ACP discovery RFC makes mandatory: `protocol.supported_versions` and `capabilities.services`.

### Removed

- **B1.3 Store API not rate-limited for reads.** WooCommerce's rate limiter is off by default and covers only POST requests, so product reads never meet it. Its knowledge-base URL redirects to the Store API article.

### Changed

- **Reports speak plain language and open with an overview at a glance.** The two scores are now called **Visible to AI** (can AI find and read your site?) and **Shoppable by AI** (can AI understand, trust and buy from your store?). The JSON keys stay `ingestion` and `commerce`. Each section has a short name and a question: Findable, Open to AI, Readable, Connectable, Browsable, Well described, Identifiable, Trustworthy and Buyable. The report's first card shows both scores with their sections, a coloured score and one clickable cell per check. The detailed results below keep the technical names and the evidence. The catalog carries the names (`label` and `question` on each group, `dimensions.json`), so the Markdown report, the knowledge base and the MCP tool use the same words.
- **Plainer level names:** Level 1 is now Reachable (was Crawlable), and Level 5 is Checkout-ready (was Transactable). The next-level sentence lists the fixes by name, without check ids.

### Changed

- **Profile detection is reliable, so the scan form no longer asks for a profile.** Six of twelve well-known content sites had been classed as stores. A `/category/` link, which every WordPress blog has, counted as a product listing, and `ItemList` JSON-LD for article lists counted as a store signal. Now only shop-specific listing paths (`/shop`, `/collections/…`, `/product-category/…`, `/catalog`) count, and `ItemList` does not. Tested on 12 content sites and 18 stores across Shopify, WooCommerce, Wix, BigCommerce and custom platforms: every site serving its real pages is classed correctly. The API still accepts a `profile` override.
- **WooCommerce is recognised from a product page.** A WordPress site that also sells, such as a shop next to a blog, often shows no WooCommerce marker on its home page. When a WordPress site has product pages, the scanner fingerprints the first one, so the WooCommerce checks run.
- **Result pages link to the site they describe, with a search snippet that answers the question.** The report heading links to the scanned site, as do the history and legal pages. The title names the site and its level, and the description asks whether the site is ready for AI agents and answers with the level, the scores and the platform.

### Fixed

- **Hosted scans reuse the pages earlier steps fetched.** Spacefast refuses a database operation above 64 KiB, and the scan cache wrote each gzipped response in one statement of up to a megabyte, so writes of larger pages failed and the next step fetched them again. Responses are now split into rows of 48 KiB in a new table, `scan_job_cache_parts`, and read back one row per statement. A response that packs to more than a megabyte is still not cached. The old `scan_job_cache` table is dropped.
- **UI alignment audit across every page, width and theme.**
  - The https:// prefix in the scan form now sits on the same line as the typed text. The input's vertical padding had pushed its text 5px below the prefix.
  - The "checks explained" links on the home page sit at the bottom of each card, level across a row. The headline breaks into balanced lines on phones.
  - The report hero's JSON, Markdown and Badge links share a baseline with the meta line. The level badge aligns with its heading, and a long URL title wraps after the scheme instead of mid-word.
  - The knowledge base's journey rail runs from the first step to the last without crossing the step numbers, and stacks into two rows on phones instead of being cut off. The filter bar's border matches the content width.
  - Check-map section titles wrap instead of being cut off at tablet widths. Tags on report cards and the legal summary counts align with their neighbours. The history page hero matches the other report heroes.
  - Monospace labels use a full font stack, so Chrome and Firefox show a sans monospace instead of Courier.

## [0.14.0] - 2026-11-04

### Added

- **Three checks for what agents do once they reach a store** (catalog 0.8.0):
  - **A3.14 Purchase controls have accessible names.** Browser agents act through the accessibility tree, and OpenAI documents that the ChatGPT agent in Atlas reads ARIA labels and roles. The check finds the add-to-cart control and its form on the sampled product pages and fails when the button has no accessible name. It warns when another control in the form, such as a quantity field or a size select, has none.
  - **B5.10 UCP signing keys are public and complete.** It fails when the UCP profile publishes private key material, and warns on a key without the members UCP requires or a duplicate kid.
  - **B5.11 UCP MCP tools match the declared capabilities.** When the profile declares an MCP binding, the check lists the server's tools read-only (stateless first, then with a session) and compares them with the tools UCP defines for checkout and cart. A profile that promises a cart its server cannot create is a gap agents hit when they try to buy.

### Changed

- **The scan form accepts a URL without https://.** The field shows a fixed, greyed https:// in front of what you type, the standard "leading add-on" pattern. A pasted https:// is removed so it never appears twice, and an http:// URL is kept as typed. Without JavaScript the server adds https:// to a bare domain as before.
- **npm packages carry keywords and point their homepage at the hosted scanner.** The core package README links the hosted scanner and the CLI.

## [0.13.1] - 2026-11-03

### Changed

- **Every document reviewed for currency, accuracy and plain language.** The README, the contributor and agent guides, the package READMEs, every document under `docs/`, all 100 knowledge-base articles, the guide, all fixes and the catalog's check descriptions were checked against the code and rewritten for readers new to the topic. Terms are explained where they first appear, sentences are shorter, and no prose uses semicolons. Outdated statements were corrected, for example the README still described release 0.7.0 and 64 checks, several check descriptions disagreed with what the code decides, and decision records now say where a later decision amended them. The report and page texts the code writes follow the same rules.
- **The Wix and BigCommerce MCP checks (A4.8, B5.9) skip on a rate limit or gateway error** (HTTP 429, 502, 503, 504) instead of reporting that no server answers, as A4.4 already did.
- **The URL policy also refuses IPv6 multicast addresses** (`ff00::/8`), as it refuses the IPv4 multicast range.

## [0.13.0] - 2026-11-03

### Changed

- **The scanner recognises 13 platforms and names the one it found at the top of every report** ([decision 0019](docs/decisions/0019-platform-specific-checks.md)). Besides WordPress, WooCommerce and Shopify it now recognises BigCommerce, Wix, Adobe Commerce (Magento), Squarespace, Square Online, PrestaShop, Salesforce Commerce Cloud, Shopware, Ecwid and Webflow. The report header shows the platform and links the platform-specific checks that ran, and those checks carry the platform's name in the results. Checks for other platforms are no longer mentioned at all, which replaces the "N check(s) left out" sentence. B1.1 records the fingerprint that decided. `target.platform` gains the new values, and consumers treat an unknown value as `unknown`. Store platforms always get a store profile.
- **Twelve platform checks** that read a platform's own interface, or the public trace of one of its settings, and name the setting: A2.8 WordPress search engine visibility, A2.9 Squarespace AI crawler setting, A2.10 Webflow traffic control, A2.11 Square Online search visibility, A2.12 Salesforce robots.txt not on the staging preset, A3.12 PrestaShop friendly URLs, A3.13 Ecwid store pages have their own URLs, A4.7 WordPress REST API readable, A4.8 Wix site MCP server answers, A4.9 Shopware agentic files, B1.9 Adobe Commerce catalog over GraphQL and B5.9 BigCommerce Storefront MCP. Each runs only on its platform (the WordPress checks on WooCommerce too), cites the platform's documentation and has a knowledge-base article. Catalog 0.7.0.
- **The scan console counts and logs only the checks for the recognised platform** (status, counter, phase label and replay). A running scan no longer names or counts other platforms' checks. The job page shows step progress as a percentage.
- **The "no checkout" cap names no platform.** Its reason reads "no checkout an agent can use is advertised", followed by the checks that lift it, limited to the store's platform. A Shopware report no longer mentions a Shopify storefront.
- **A score cap needs evidence** (scoring 0.7.0). The "not crawlable" and "no checkout" caps hold only while a gate check failed or warned, not when the scan could not evaluate it. Before, a store where no product page was found to sample (A3.2 not applicable) stayed at Level 0 and was also capped at 40 for ingestion, as if agents could not read it. The level still waits for the evidence, but the score no longer punishes its absence. The cap's "lifted by" list now leaves out the checks of every platform the store does not run.
- **The scanner asks for pages the way a browser does.** Its default Accept header no longer names `application/json` (the wildcard still covers it). PrestaShop answers a page request that lists JSON with an empty body, so every PrestaShop store was read as an empty page.
- **MCP probes fall back to the initialize handshake** when a server on the 2025 session transport refuses `server/discover` with a plain HTTP 400 ("Session ID required"), as BigCommerce's Storefront MCP does. A4.4, A4.8 and B5.9 use the fallback.
- **Platform advice for the new platforms** in the robots.txt, crawler access and Product JSON-LD fixes. A fix section can be named by any platform's label or id (`## On Magento`).

## [0.12.0] - 2026-11-03

### Added

- **A data processing and privacy page** at `/data-processing` (also `.md`, and `/privacy` redirects there), linked from every page's footer. A short version with the most important facts comes first: public pages only, an honest user agent and robots.txt, the request budget and scan limit, public profiles for root URLs and their retention, unsaved one-time scans, no cookies or tracking, and email only for monitoring. The details follow: what a scan fetches, every stored record with what it holds and how long it is kept, browser storage, hosting, options for store owners, and rights under the GDPR. Numbers come from the configuration, and the monitoring section appears only when monitoring is on. The home page links to it in place of the scan policy paragraph.
- **Knowledge-base guides** for topics no single check covers, at `/knowledge-base/guides/<slug>`, with a hub at `/knowledge-base/guides` and a section at the top of the index. Guides are available as Markdown too, and are listed in `/knowledge-base.json`, `/llms.txt`, `/llms-full.txt` and the sitemap. A guide names the checks it is about (whose articles link back to it), opens with the answer and ends with at least two public sources, which become its citations. The catalog build validates guides like articles. The first guide explains why a store that blocks honest crawlers is reported as unreachable, why a web page cannot scan another site from the visitor's browser, and how an owner can let the scanner through.

### Changed

- **Scores are capped by the capability that decides whether agents can use the store** (scoring 0.6.0, [decision 0018](docs/decisions/0018-score-ceilings.md)). Before, a store agents could not buy from scored up to 90 for commerce, and a store that challenged every honest agent up to 84 for ingestion. Ceilings from `packages/catalog/data/ceilings.json` now hold a dimension down while a capability gate is unmet. Without a checkout an agent can use (B5.2, B5.3 or B5.8), commerce is at most 60. When agents cannot reach and read the site (the Level 1 gates), ingestion is at most 40 and commerce at most 30. `scores.ceilings` records the cap, the raw score, the reason and the checks that lift it, and every report says so next to the score. Section scores are not capped.
- **Level 5 needs a declared checkout**: B5.2 (a UCP profile with a checkout capability and a payment handler), B5.3 or B5.8, instead of any UCP profile. An empty profile no longer makes a store Transactable. B5.1 and B5.2 are weight 3.
- **Platform-specific advice only reaches the platform it is for.** Fixes are platform-neutral, and advice for one platform lives in `## On WordPress`, `## On WooCommerce` or `## On Shopify` sections of the fix (catalog field `platform_notes`). A result's fix carries the notes for the detected platform in its agent prompt. A Shopify store no longer reads "On WordPress/WooCommerce, prefer the platform's own hooks…", and WordPress paths left the snippets. The MCP `get_fix` tool takes an optional `platform`. The knowledge base lists every platform's note under "By platform". Catalog 0.6.0.
- **Reports leave out the checks of other platforms.** A check that reads an interface only one platform has (the WooCommerce Store API and cart, Shopify's `products.json` and agent surface) never ran on another platform and was never scored there. The HTML and Markdown reports no longer list it or count it as "did not apply", and say in one line how many checks were left out and why. The JSON result keeps every check, as its contract requires, with the message "requires Shopify, which was not detected" in place of "does not apply to this profile". The knowledge base marks these checks "WooCommerce only" or "Shopify only".
- **A4.6 WebMCP tool declarations** reads forms only, as the declarative API defines. It warns when a form carries `toolname` without `tooldescription` (Chrome registers no tool then), or when a page that declares tools sends `Permissions-Policy: tools=()`, which turns WebMCP off. It stays informational and is never scored. The OpenAI help article on ChatGPT's site tools is now a source.

## [0.11.0] - 2026-11-03

### Changed

- **Hosted scans run in steps until they are done.** A scan no longer stops after one request's 24 seconds. It runs as a job in steps of 20 seconds, each inside one request, with the state and the fetched responses stored between steps. A check cut off by a step runs again in the next one, so slow stores get a full report instead of checks marked "not run". The next step is run by whichever comes first: the home page (which now shows which step it is on), the app calling itself, a sweeper cron every hour, or the next request for the same site. A lease keeps two steps from running at once. The overall limits are 60 requests (up from 40), 12 steps and 3 minutes of active scanning, and checks these limits leave unanswered name the limit. `POST /api/scan` answers `202` with `status_url` and `continue_url` (`GET /api/scan/jobs/<id>`, `POST /api/scan/jobs/<id>/continue`) when a scan needs more steps, and the MCP tool asks the agent to call again. New settings `SCAN_STEP_MS`, `SCAN_MAX_STEPS` and `SCAN_MAX_ACTIVE_MS` replace `SCAN_DEADLINE_MS`. One-time scans (paths and queries) that need several steps keep their progress on the server only until the result is delivered, and for no more than about two hours. Scanning stays on the server, because a browser cannot read most store responses across origins (decision 0017).
- `startScan()` and `continueScan()` take `onProgress`, with requests and active time counted across steps. The checks a scan's overall limits leave unanswered say which limit ended it (steps, active time, or a store too slow to make progress) instead of the last step's deadline. `@agentic-readiness/core/testing` adds `fetcherAsFetch()`, which puts a recorded store behind a platform fetch.

## [0.10.0] - 2026-11-03

### Added

- **Resumable scans** in `@agentic-readiness/core`. `startScan()` and `continueScan()` run one scan as several short steps with a small, versioned JSON state in between (about 2.6 KiB on the recorded WooCommerce store), for hosts that must answer each invocation within a fixed time. A step that runs out of its own time (`stepDeadlineMs`) or requests (`stepBudget`) is not a skip: the check it cut off runs again in the next step. The request budget counts across steps, and a request that is sent again is never counted twice. `maxSteps`, `maxActiveMs` and a stall guard end the scan with the usual `budget_exhausted` meaning. An optional `ResponseCache` keeps responses between steps. Split into steps, a scan returns the same result as one `scan()` call over the same responses. `duration_ms` is the active time and `steps` the number of steps. A state from another scanner, catalog or scoring version is refused. `scan()` is unchanged. See decision 0016.
- **Legal signals**, a new category of 24 checks in six sections: seller identity and complaints, privacy notices and choices, withdrawal, returns and cancellation, accessibility, product and price information, and AI transparency and content rights. Each check names the laws it relates to. The laws come from a dated registry with official links across the EU and national examples, the UK, Switzerland, the United States and California, Canada, Australia, Brazil, Argentina, Chile, Colombia and Peru. A check runs only for the markets a store appears to sell to, detected from its domain, page language, hreflang, currency, addresses and register numbers (with check digits), or chosen with `--markets`. Legal signals are never scored and never part of the level. The hosted report links them on `/sites/<host>/legal` and `/r/<id>/legal` (also `.json` and `.md`). These pages are noindex, disallowed in robots.txt, and kept out of the sitemap and the readiness exports. Every rendering opens with the notice that this is a technical evaluation, not legal advice. Each check has a knowledge-base article under `/knowledge-base/legal-signals`. See decision 0015.
- **A browser regression suite** for the hosted pages (`pnpm test:layout`, run in CI and by `pnpm check`). It automates the rules of the 2026-11-03 UI audit against a fixture-backed server:
  - no horizontal page scroll, catalog ids on one unclipped line, 44px controls and the shared shell on every page family at 320, 375, 768, 1024 and 1440px, in both themes and at 200% text
  - the scan console handing over to its report with the shared view-transition names, with the arrival animation playing once and never under reduced motion
  - map cells linking to their checks, the knowledge-base filter, chips and `/` shortcut, the remembered theme, and the home page without JavaScript
- **Readable `/sites/<host>` profiles for root URLs.** Subdomains keep separate identities. Immutable scan snapshots and history are kept after the full report expires. Scans of a path or query return reports for the browser only, without storing a result, history, target, monitoring or progress. One atomic host reservation limits new scans to one per minute across paths, HTTP, MCP and monitoring. Root cache hits replay safely, denied scans return retry guidance, and failures use up the minute. Redirected roots keep their submitted identity for rescan actions. Scope, privacy and legacy behaviour are documented and covered by regression tests.
- **Sharing metadata.** Server-rendered canonical, Open Graph and X metadata with branded 1200 × 630 PNG previews for the home page, knowledge base and hosted reports. Connected schema.org entities describe the app, the articles and the actual stored report scores, with JSON exports for agents. Active reports now allow search indexing and crawling by assistants and social networks. JSON and Markdown exports point to the canonical HTML, so they are not indexed twice. Listed training crawlers keep their report restriction. The images are generated at build time only, and regression tests and a sharing-metadata guide document the policy and its maintenance.
- **Knowledge base navigation:**
  - a journey rail of the nine sections (find, get in, read, connect, catalog, products, identify, trust, buy) with the current one lit
  - a strip of every check as a cell, with the current check and section highlighted
  - a sidebar with the section's checks and an article outline that follows your scroll position
  - a reading progress bar, and previous and next links across sections
  - on the index, a filter by text and priority (press `/`)
- **Knowledge base for agents:** `/knowledge-base.json` lists every section and check with priority, level gate and URLs. Section pages are Markdown too. Markdown articles open with YAML front matter (canonical URL, check id, priority, level gate). HTML and Markdown answers carry `Link` headers to each other. Article sections are `<section>` elements. The MCP server answers `explain_check` with the article.
- **A knowledge base on the hosted app**: an index at `/knowledge-base` (first published at `/knowledge`, which now redirects), a page per section, and one article per check (64). Each article explains what the check looks at, why it matters to AI agents, exactly how the scanner decides, how to fix it on WordPress and WooCommerce, Shopify or any other stack, how to verify the fix, common mistakes and an FAQ. The page adds the check's priority, the level it gates, its dependencies, the fix with the prompt for a coding agent, and its specifications from the catalog. Every page is also Markdown (append `.md` or send `Accept: text/markdown`), carries schema.org TechArticle, FAQPage and BreadcrumbList data and a canonical URL, and is listed in the new `/sitemap.xml` and in `/llms.txt`. `/llms-full.txt` holds every article in one file. `/knowledge-base/<check id>` redirects to the article. Articles live in `packages/catalog/knowledge` and the catalog build validates them (see `docs/knowledge-base.md`). The home page's section cards link to their section of the knowledge base.
- **A check map on every HTML report**: one cell per check, grouped by section with the section score, coloured by verdict and linked to the check (opening its section). When you arrive from the scan console, the console's grid and radar morph into the check map and the level badge (cross-document view transitions where the browser supports them). The cells pop in as a wave, the level badge bounces with a burst of confetti, and the map says how long the scan took. The animation plays once per scan, never on reload or a shared link, and respects reduced motion. Deep links to a check (`/r/<id>#B2.2`) open its section and scroll to it.

### Changed

- After the request budget or deadline is used up, the remaining checks still run against pages the scan already fetched. Only checks that need a new request are skipped. On a slow store, 16 of 17 legal checks that used to be reported as not checked are now answered.
- The published `@agentic-readiness/core` type declarations no longer import the private `@agentic-readiness/catalog` and `@agentic-readiness/ui` packages. Their types are bundled in, so consumers type-check without vendoring them. A test guards the built declarations.
- Scores never stand on a sliver of the catalog (scoring 0.5.0). Each dimension records the share of its applicable weight the scan answered (`scores.coverage`). Below half, commerce and section scores are `null`, and every report says "Incomplete" with the share instead of printing a number. Before, a slow store whose scan ran out of time after one passing commerce check scored 100 for commerce. Checks now run level gates and blocking checks first, so a short time budget leaves optional probes unanswered rather than the gates. A check that depends on a check the budget never reached is reported as unanswered, not as blocked by a failure.
- A navigation button is never taken for a policy link. "Return to shop" no longer counts as a returns-policy label, and a footer link whose path names the policy document (`/return-policy/`) ranks above a stray word in a body button.
- Removed the home page's animation pause control and its saved preference. Background signals still respect the operating system's reduced-motion setting and the active scan state. The hero copy now reads “Built WooCommerce first. Works on any store.”
- Shared Signal Network design across the home page, reports, knowledge base, history, monitoring and error pages: full-width Woo-purple headers, an uppercase homepage headline with a lime accent, responsive scan controls, an icon theme toggle with dark mode by default, accessible links and focus states, and background signals that respect reduced motion. Offline reports keep the same self-contained design and the existing handoff from progress to report. Check maps add verdict symbols and larger targets.
- Hosts are stored without a leading `www.`, so `www.example.com` and `example.com` share one cooldown, one history, one badge and one monitoring subscription. Other subdomains keep their own key. Rows stored before are moved to the bare host on first use, `/h/www.example.com` redirects to `/h/example.com`, and the scan still fetches the URL that was given.
- The footer reads "An experiment by Matthias Reinholz" with links to the knowledge base and the source, without the licence line. The home page no longer repeats that nothing requires credentials.

### Fixed

- UI consistency across page types. Catalog ids and badges stay on one line, forms adapt to the width actually available, tablet score cards balance, and panels, text, controls and code examples share consistent sizing. Narrow and enlarged-text layouts reflow result and knowledge rows and level summaries. Hover and focus no longer overlap map cells or get held by finished arrival animations. Monitoring dialogs keep their close action and fields usable, and wide examples and tables have scroll regions you can reach by keyboard.
- Patched the build-only social-image dependency `fflate` from 0.7.3 to 0.7.5 through a narrow override. This resolves GHSA-px8p-9vwx-vf98 and keeps the generated images unchanged.
- The homepage headline no longer paints a purple rectangle over the animated network. A shared feathered network mask and lower intensity on narrow screens keep the text contrast without covering the decoration. Compact hero metadata and level descriptions keep readable line lengths.

## [0.9.0] - 2026-11-02

### Fixed

- A store that rate-limits the scanner while the target is being resolved (sitemaps, product discovery, Shopify's fallback policy pages) now gets a report whose remaining checks say they were not run because the store answered 429, instead of an internal error. Unexpected failures of a streamed scan name the error.

### Added

- A live scan console on the home page. The scan streams from `POST /api/scan/stream` as server-sent events, and the page animates what actually happens: the five phases, one grid cell and one radar blip per check verdict, the request counter against the budget, and a terminal log. Then it reveals the level and opens the report. A result reused within the cooldown is replayed from its stored verdicts. Spacefast holds streamed responses back until they end, so the scan request also writes its events to a `scan_progress` table, and the page polls `GET /api/scan/progress/<token>` every 600 ms. Events are numbered, so the stream and the poll never apply one twice, and the cleanup cron removes progress older than an hour. Without JavaScript the form posts as before. The engine gains `ScanOptions.onProgress` (phase, target and check events with the running request count and elapsed time).

## [0.8.0] - 2026-11-02

### Changed

- The README and the home page point at the published packages: `npx @agentic-readiness/cli scan <url>`, `npx -y @agentic-readiness/cli mcp` for local coding agents, and `@agentic-readiness/core` as a library.

## [0.7.0] - 2026-11-02

### Changed

- Two packages are published instead of five ([decision 0013](docs/decisions/0013-two-published-packages.md)): `@agentic-readiness/cli` (the command line with the local MCP server inside, every workspace package bundled in) and `@agentic-readiness/core` (the engine with the catalog and the visual system bundled in and their types inlined). `catalog`, `ui` and `mcp` are private workspace packages, and the release packs and publishes the two. The home page no longer advertises `npx` until the first publish. The release workflow publishes the attested tarballs through npm trusted publishing (OIDC, repository variable `NPM_TRUSTED_PUBLISHING`) and uses the `NPM_TOKEN` secret only for a package's first publish.

## [0.6.0] - 2026-11-02

### Changed

- On a site with several markets, the scan samples the market the owner typed. The product sitemap whose name carries the input URL's locale (ikea.com/us/en/ → `prod-en-US_1.xml`, not the first child in the index) is fetched first, product URLs under that path win, and the report warns when the sample had to come from another market.

## [0.5.0] - 2026-11-01

### Added

- A wall-clock budget per scan (`ScanOptions.deadlineMs`, hosted default `SCAN_DEADLINE_MS` = 24 s, under the platform's 30 s request limit). Once it is used up, the remaining checks are skipped with that reason and the report is still produced, instead of the platform answering with an error for a slow store.
- **Reports lead with what to do** ([decision 0012](docs/decisions/0012-priorities-and-honest-non-answers.md), [the report and accuracy audit](docs/audits/2026-11-01-report-and-accuracy-audit.md)). Open findings are ordered by the level they unlock, then by tier (blocking, expected, nice to have, informational), then fail before warn, and every surface renders the same list. Summary lines count findings per tier and split skips into "did not apply" and "could not run". Sections made only of optional checks are tagged and their score muted. Every report ends with what the scan did and did not do (pages read, no JavaScript, no sign-in, no impersonation).
- A refused home page (403, 429, a bot-management challenge) now produces a Level 0 report that names the product behind the refusal (Cloudflare, Akamai, DataDome, Vercel, Imperva, HUMAN, AWS WAF) and evaluates robots.txt and the sitemap, instead of aborting with "not reachable".
- The fetcher unpacks gzip sitemaps, keeps at least 150 ms between requests, and retries once on a dropped connection or a short `Retry-After`. The scan lists every request that failed and every 429 in its warnings. Scan option `minIntervalMs`.
- Store detection reads cart vocabulary in a dozen languages, and Product JSON-LD. Product sitemap names from large platforms (`prod-<locale>_N.xml`, `products_N.xml`, `artikel`) and more product URL forms are recognised. A sitemap larger than the 2 MB the scanner reads keeps its complete entries before the cut. When no URL matches a product pattern, a few linked pages are fetched and kept as product pages when they carry Product JSON-LD or an add-to-cart control. Child sitemaps that fail to parse are named in the warnings. After a 429 the fetcher backs off (one second, then two) and stops after three persistent ones, and the remaining checks say so. A headless Shopify storefront is recognised, and the Shopify-only checks do not apply to it.
- **Catalog 0.4.0 and scoring 0.4.0.** Level 2 accepts Shopify's UCP catalog (B5.8) as a readable catalog. B5.8 weighs 3, and B1.8 (`products.json`, undocumented and rate-limited) weighs 2. A3.5 (main landmark) is informational. Content sites are not scored on product URLs in their sitemap (profiles can exclude checks). `next_gate` lists only alternatives the profile includes. Texts and citations were corrected after a research pass over every vendor programme: Google's merchant listing rules (Offer, price above zero, `priceValidUntil`, required name and image, Organization-level return and shipping policies, 500 px images from 2027-01-31), Lighthouse's llms.txt rule, the timing of the shared training token, Bing's 2027 dates, Amazon's reading of `noarchive`, OpenAI's feed fields, UCP's payment handler fields and its 2026-08-25 key change, the MCP 404 rule, and Shopify's agentic storefront defaults.

### Changed

- A page the scanner did not read is never scored. Content checks judge only sampled pages that answered 2xx and say which did not. A refused policy page is a note on A2.4 and a B4.6 finding instead of a Level 0. Rate-limited probes are inconclusive. Absent optional files (usage-preference signals, WebMCP, security.txt) are not applicable.
- Policy, contact and listing links are chosen by label quality, footer position and path, as whole words including compounds, and never from product, listing or account URLs. A policy link that leads to a product page fails the policy check with that reason. On Shopify the platform's own policy page replaces a pick matched by path alone. Shopify's store root no longer counts as a product URL. A headless Shopify storefront is recognised, and the Shopify-only checks do not apply to it.
- ProductGroup variants carry the offers, GTINs, MPNs and SKUs that B2.2, B2.3, B2.4, B3.1 and B3.4 read. A GTIN counts only when it has 8, 12, 13 or 14 digits. B2.5 matches images by path across `srcset` and `<picture>`, prefers one with alt text and treats a failed HEAD as inconclusive. Organization-level return and shipping markup satisfies B2.4.
- Messages name the thing: the image and its issue, which of brand and MPN is missing, the contact pages found, the from and to of a redirect, the element that comes before the main landmark, the sitemaps read, and the reason a page was not fetched. The head check ignores `<title>` inside inline SVG. The Markdown report prints the working rules for coding agents once. The brief for a coding agent per finding stays in the HTML report and the MCP `get_fix` tool.

## [0.4.0] - 2026-11-01

### Added

- **Catalog 0.3.0 and scoring 0.3.0** after an audit of the conventional technical SEO that AI answer products inherit from the indexes they run on ([docs/audits/2026-11-01-technical-seo-audit.md](docs/audits/2026-11-01-technical-seo-audit.md), [decision 0011](docs/decisions/0011-technical-seo-scope.md)). New checks: A1.8 listing pages link to products and further pages, A2.7 render resources not blocked by robots.txt, A3.7 product URLs answer directly over HTTPS (with http:// and host-variant consolidation), A3.8 title and description on every page, A3.9 conditional requests supported, A3.10 mobile viewport declared, A3.11 document head is well-formed (metadata after a head-breaking element, meta refresh, doctype, charset).
- A head scanner that knows where each element sits (`parsers/head.ts`), and HTML parser helpers for the root `lang`, external scripts, stylesheets and headings. Fixtures can now record redirected requests (`final_url`, `redirects`).

### Changed

- A2.6 fails on `nosnippet`, `max-snippet:0` and `data-nosnippet` around the main content (Google builds AI Overviews and AI Mode from snippet-eligible pages only, and Apple generates no web answer without a snippet). It recognises Bing's `ai-grounding:disallowextended` and the `Bingbot:`-prefixed header form, has weight 3 and gates Level 2.
- A3.3 fails at Googlebot's 2 MB document cutoff instead of warning. A3.4 judges whether the canonical is correct (HTML and Link header, absolute, single, same origin, HTTPS, self-referencing) instead of only whether it is present.
- The recorded stores carry viewport tags, ETags with 304 answers, host-variant redirects and a listing page with pagination.

## [0.3.0] - 2026-11-01

### Added

- **Catalog 0.2.0 and scoring 0.2.0** after a research audit of every check against the documented crawlers, the current standards and drafts, the published evidence on AI ingestion and every comparable scanner ([docs/audits/2026-10-31-check-audit.md](docs/audits/2026-10-31-check-audit.md)). New checks: A1.7 sitemap lastmod, A2.5 user-triggered fetchers (replacing the misread Web Bot Auth check), A3.6 honest 404s, A4.4 MCP endpoint reachable (replacing the invented Agent Skills index), A4.6 WebMCP declarations (informational), B1.8 Shopify `products.json`, B5.8 Shopify agentic storefront. Retired: B3.6 per-channel identity (folded into B3.1 to B3.4), B5.5 payment-handler signals, B5.6 x402 and AP2 signals. The `shopify` requirement joins `woocommerce` and `products`.
- Every catalog check is implemented (38 new implementations: A1.4, A1.7, A2.3 to A2.5, A3.1, A3.3 to A3.6, A4.1 to A4.6, B1.3 to B1.8, B2.3 to B2.6, B3.3 to B3.5, B4.4 to B4.6, B5.1 to B5.4, B5.7, B5.8), each with tests for every branch. New parsers for Link headers, product feeds, prices, usage-preference signals and sitemap lastmod. The recorded WooCommerce store reaches Level 5, and a recorded Shopify store exercises the Shopify checks. MCP endpoints are probed with a read-only JSON-RPC `server/discover` POST, the only request the scanner sends with a body.
- **History per host** ([decision 0009](docs/decisions/0009-result-storage-tiers.md)): a `scan_history` table with one row per distinct state (level, scores, score per section, verdict and skip reason per check, catalog and scoring version) that is never purged. Also `/h/<host>` with a trend chart and what changed between states, `/h/<host>.json`, a "since the previous state" block on every report, the MCP tool `get_history`, and the owner export `/internal/export/history.json?host=`.
- CLI `diff <before.json> <after.json>` (`--format text|json`), with exit code 3 when anything changed.
- The hosted app serves its MCP server card at `/mcp/server-card` and lists it in `/.well-known/ai-catalog.json` (the community path keeps answering). Its robots.txt states a shared training decision (`__usage_ai-training`) and names the crawler classes.
- The fixture fetcher answers per request method and headers, and caches like the production fetcher.

### Changed

- `@agentic-readiness/ui` is a version surface of the release script and a packed release asset, since `@agentic-readiness/core` depends on it.
- Crawler tokens are evaluated by class ([packages/core/src/checks/crawlers.ts](packages/core/src/checks/crawlers.ts)):
  - A2.1 passes on any stated training decision and never fails.
  - A2.2 evaluates the eleven search and assistant crawlers, with Googlebot and Bingbot as core, and is a Level 1 gate together with A2.4.
  - A2.6 adds `data-nosnippet`, Bing's `noarchive`, `nocache` and `ai-grounding:disallow` and Apple's `isAccessibleForFree`, and records `noai` as a preference only.
  - A1.5 skips when llms.txt is absent and requires only the H1 the proposal requires.
  - A3.1 accepts a `.md` twin or a Markdown alternate.
  - A3.3 thresholds follow Googlebot's 2 MB limit.
  - A4.1, A4.3, A4.5 and B5.1 to B5.4 follow the current MCP, A2A, UCP and ACP documents.
  - B4.5 is a Level 4 gate, and B4.7 is informational.
  - Levels: see [docs/scoring.md](docs/scoring.md).
- The scanner never impersonates another agent ([decision 0010](docs/decisions/0010-honest-fetch.md)), and the security model says so.
- A2.4 fails only when the home page, robots.txt or a product page is blocked. A blocked policy page alone warns. The resolver no longer picks policy pages from the account, login, cart or checkout areas, which answer with login walls. This was found on the first live scan after deployment: woocommerce.com linked its support form under `/my-account/`, and the 403 there made a reachable store "Not reachable".
- The robots.txt parser keeps Content-Signal, Content-Usage and License lines with their group. `ResultSnapshot` carries section scores and skip reasons. A check whose dependency did not apply is itself not applicable, instead of "dependency failed". Shopify policy pages are found at their fixed paths when the footer does not link them.
- The visual system moves to a new `packages/ui` built on the framework layer of the app-base UI standard: Tailwind CSS 3.4 with the shadcn token contract, class recipes transcribed from its primitives (button, badge, card, input, select, alert, textarea), lucide icons and self-hosted Inter. It is compiled at build time and inlined, so the CLI's HTML report stays one file. The report and the hosted pages are re-rendered on it. Dark stays the default theme, with a bright blue primary colour in both themes ([decision 0008](docs/decisions/0008-ui-standard.md)). No React or app framework.
- The hosted app serves the Latin subset of Inter under `/fonts`, and the development server serves `public/` and the fonts like production.

### Fixed

- `pnpm scan <url>` at the repository root runs the CLI again (it invoked a bin that is not linked inside its own package and left out the `scan` command).

## [0.2.0] - 2026-10-31

### Added

- Per-section scores: `scores.groups` in the result object (one weighted score per catalog section, null when nothing applied), shown in the HTML and Markdown reports.
- Composed agent briefs: every fix prompt is wrapped in context (scanner, target, observation, specs) and working rules (investigate first, durable fix over patch, verify) by `composeAgentPrompt`. The HTML and Markdown reports and the MCP `get_fix` tool (`agent_brief`) use it.
- Dark theme by default with a light theme toggle, remembered per browser. A shared visual system (`html-theme.ts`) for the report and the hosted pages, with a blue accent.
- Monitoring: a report offers to rescan the host weekly and send an email when the level, a score or a check result changes. Double opt-in, hashed tokens, one-click unsubscribe, a daily cron that processes due subscriptions, and a `Mailer` interface with Brevo (configured) and Resend adapters (`MAIL_PROVIDER`, `MAIL_API_KEY`, `MAIL_FROM`). Result diffing lives in core (`diffSnapshots`).
- A durable `targets` registry of every host scanned (first and last seen, count, last level and scores) that is never purged, plus token-protected owner exports at `/internal/export/targets.json` and `/internal/export/monitors.json` (`ADMIN_TOKEN`).

### Changed (scoring 0.1.1, catalog 0.1.3)

- Level gates count as passed automatically only for checks outside the profile's catalog. A check the profile includes but that could not run on the target (no product pages found, dependency failed, not implemented) now blocks the gate. So a store without discoverable product pages stays at Level 0 instead of being waved through to Level 2. Product-page checks declare a `products` requirement, and content sites declare it unmet.

### Security

- The scanner follows robots.txt for its own user agent (`RobotsGatedFetcher`). Refused URLs are listed in the scan warnings.
- The per-host cooldown applies regardless of profile overrides. Parallel submissions share one scan. At most four scans run per isolate.
- Two check regexes with polynomial backtracking (price text, shipping details) were rewritten with bounded repetitions on capped text. robots.txt wildcard matching is a linear scan instead of a regex.
- Fetcher: a failing body stream becomes a failed response instead of an unhandled rejection. Sitemap entries are resolved and limited to the target origin. Store API payloads are validated before use.
- Hosted app: `Vary: Accept` on negotiated report URLs (the live CDN was serving HTML to Markdown clients), an error handler that never leaks messages, numeric environment variables validated at startup, the export `limit` guarded, and constant-time admin token comparison.
- Monitoring: a mail provider failure affects one subscriber only. Rows are claimed before work. Confirmation emails are capped at five per address per day. Pending requests are purged after 48 hours. Monitoring stays off unless `APP_BASE_URL` is set explicitly. Cron runs are at least ten minutes apart per isolate.
- Markdown report fences survive backticks in target text. The observation line in agent briefs is sanitised.

### Changed

- Catalog 0.1.1: fix texts reworded (placeholders use example.com, and B1.4, B2.5 and B3.6 no longer refer to a plugin or a report table that does not exist).
- Catalog 0.1.2: redirected spec URLs updated (OpenAI crawler and product feed docs, Google's crawler list, Agent Skills, x402, ACP). A3.5 cites the WAI-ARIA 1.2 landmark roles, and B3.6 Meta's catalog field reference. A4.1 cites SEP-2127 and says the server-card path is a convention this scanner adopts. The agent prompts of A1.3, A3.1, B2.3, B3.1, B3.3, B3.5 and B4.3 are platform-neutral with a WordPress/WooCommerce clause.
- A1.1 warns on every 4xx robots.txt (RFC 9309: unavailable means allow all) and fails only on 5xx and network errors. The fetcher decodes bodies with the declared charset, falling back to UTF-8. `applies` in the result object is documented as false exactly for `not_applicable`, and B2.2 and B3.2 skip that way without product pages.
- Test coverage: `mapFetcher`, `targetFor` and `runCheck` on `@agentic-readiness/core/testing` for check tests per branch. Tests for the runner, the HTML, JSON-LD and security.txt parsers, the sampler, the SQL stores (through an in-memory fake), the CLI formats and exit codes, and the MCP tools. The CLI rejects an unknown `--profile` as a usage error.
- Hosted app: `app.ts` split into `scan-service.ts`, `routes/report.ts` and `routes/internal.ts`. The SQL stores share a base class and validate rows. The app's TypeScript project no longer has Node types, so Node-only globals fail the build there.
- The companion plugin is dropped ([decision 0007](docs/decisions/0007-no-companion-plugin.md)). Its contract document, the `PLUGIN_URL` variable and the plugin link on WooCommerce reports are removed. `auto_fix` now means "mechanical fix", and the docs column reads "Mechanical".
- Documentation corrected to match the code: release status and the current level ceiling (2) in the README, the CLI run from a checkout until the packages are on npm, secrets and workflow facts in SECURITY.md and the security model, robots.txt handling stated honestly, and hosting notes recorded as verified.
- Hosted app: `robots.txt` declares explicit decisions for AI training crawlers and keeps `Content-Signal` inside the group. `security.txt` expires within a year and links the policy. `llms.txt` no longer links the POST-only API as a page. The badge label reads "agentic readiness". The report footer carries the source link, licence and disclaimer.
- The HTML report groups checks into collapsed, colour-coded sections with a score each and an expand-all control. Fix details carry a copy button for the agent brief.
- Home page form and layout rebuilt on the shared theme (consistent spacing, custom select chevron, focus states).

## [0.1.0] - 2026-10-31

### Added

- Monorepo scaffold: catalog, core engine, MCP server package, CLI, hosted Hono app for Spacefast Functions, recorded store fixtures, CI and release workflows.
- Deployment through Spacefast's GitHub integration, configured in the repository-root `sf.jsonc`. GitHub Actions holds no Spacefast credentials.
- Security headers on every worker response and RFC 8288 discovery links (`llms.txt`, MCP server card) on the home page, set by the app because platform header rules do not reach worker responses.
- Catalog of 55 checks in 9 sections with levels, profiles, fixes in three forms, and a versioned result schema exported as JSON Schema.
- Implemented checks: A1.1, A1.2, A1.3, A1.5, A1.6, A2.1, A2.2, A2.6, A3.2, B1.1, B1.2, B2.1, B2.2, B3.1, B3.2, B4.1, B4.2, B4.3, B4.7.
- Reporters: JSON, Markdown, HTML, SVG badge.
- Hosted app: scan form, JSON API, report in three formats, badge, llms.txt, MCP server card, Streamable HTTP MCP endpoint, result storage in the Space database, retention cron.
