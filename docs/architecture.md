# Architecture

One engine, three hosts. The engine in `packages/core` runs a scan: it fetches a store's public pages and files and evaluates them against the checks in the catalog. The three hosts are the CLI, the MCP server (Model Context Protocol, the standard way AI agents call tools) and the hosted scanner (the web app). The CLI and the local MCP server call `scan`. The hosted scanner runs the same scan in steps through `startScan` and `continueScan`. Nothing in a check knows where it runs.

```text
                    ┌──────────────────────┐
                    │  packages/catalog    │  checks, levels, ceilings, profiles, fixes, knowledge base, result schema (data)
                    └──────────┬───────────┘
                               │
                    ┌──────────▼───────────┐   ┌──────────────────┐
                    │  packages/core       │◄──│  packages/ui     │  tokens, compiled stylesheet, class recipes, icons
                    └───┬──────────┬───────┘   └────────▲─────────┘
                        │          │                    │ (also used by apps/web)
                        │          │
          ┌─────────────▼──┐   ┌───▼──────────────┐
          │ packages/mcp   │──►│ packages/cli      │  scan | diff | mcp (stdio) | catalog | version | help
          └─────────┬──────┘   └──────────────────┘
                    │
          ┌─────────▼──────┐
          │ apps/web       │  Hono: form, /api/scan, /sites/:host, /r/:id(.json|.md), /h/:host, /badge, /mcp, /knowledge-base, /llms.txt
          └────────────────┘  runs on Spacefast Functions (worker) and on Node for development
```

Two of the five packages are published, and both are self-contained. `@agentic-readiness/cli` bundles every workspace package. `@agentic-readiness/core` bundles the catalog and the visual system and inlines their types ([decision 0013](decisions/0013-two-published-packages.md)). `catalog`, `ui` and `mcp` are private: they are build inputs for the two published packages and for the hosted scanner, which consumes them through the workspace.

## Layers in `packages/core`

1. **`http/`** holds the `Fetcher` interface and two implementations. `BudgetedFetcher` wraps the platform `fetch`. It enforces the request budget, timeouts, the body size cap, the redirect limit and the URL policy, and it caches every response per scan, so two checks never fetch the same URL twice. `FixtureFetcher` answers from a recorded map for tests and offline runs. `RobotsGatedFetcher` refuses URLs that robots.txt (the file that tells crawlers what they may fetch) disallows for the scanner. `bot-management.ts` names the product behind a refusal or challenge (Cloudflare, Akamai, DataDome, Vercel, Imperva, HUMAN, AWS WAF, Fastly), for the resolver and the honest-fetch check alike. See [security-model.md](security-model.md) for the limits.
2. **`target/`** has `resolveTarget`, which turns user input into a `Target`. A target carries the canonical origin, the detected platform, the selected profile, the parsed robots.txt, the discovered sitemap and a deterministic sample of product and policy pages. The platform is one of 13, detected from the fingerprints in `target/platforms.ts`, and the target records the signal that decided. Sampling is seeded by hostname. On a multi-market site, the market in the input URL (for example `/us/en/`) decides which product sitemap is read first and which product URLs are sampled. A home page that refuses the scanner (403, 429, a challenge) does not abort the scan. The target records the refusal (`blocked`) and the runner evaluates only what needs no page.
3. **`parsers/`** holds pure, fixture-tested parsers: robots.txt (RFC 9309 plus the Content-Signal, Content-Usage and License lines), sitemaps with lastmod, HTML and document-head helpers, JSON-LD (structured data in the page that machines read), product pages, prices, llms.txt, Link headers, product feeds, GTIN (the global barcode number of a product) check digits, security.txt and usage preferences. Checks never parse anything themselves.
4. **`checks/`** has one `Check` per catalog id. Its `run(context)` returns a verdict, a message and evidence. The context carries the target, the fetcher, the catalog definition and the outcomes of earlier checks. `registry.ts` lists what is implemented. `checks/platforms/` holds the checks bound to one platform. `crawlers.ts` holds the documented crawler tokens by class (training, search, user-triggered), which the access checks and the hosted scanner's own robots.txt share. Each check is unit-tested per verdict branch with `mapFetcher`, `targetFor` and `runCheck` from `testing/check-harness.ts`, so a branch never needs a recorded store.
5. **`runner.ts`** orders checks by dependency, with level gates and blocking checks first. It skips checks that do not apply to the profile or platform, skips dependents of failed checks, marks unimplemented checks honestly as `not_implemented`, and skips the rest as `budget_exhausted` when the budget runs out. Results come back in catalog order.
6. **`scoring.ts`** holds pure functions: dimension scores (weighted pass ratio, a warn counts half, skips drop out of the denominator), coverage, ceilings, and the gated level with its next gate. See [scoring.md](scoring.md).
7. **`reporters/`** render JSON, Markdown, HTML and an SVG badge, all from the same result object. None touches the network. `priorities.ts` orders open findings (next gate first, then the tier from the catalog weight, then fail before warn), and every surface renders that one list. `shared.ts` holds the scope note that says what a scan did and did not do, and the sentence that explains a capped score. `check-map.ts` draws one cell per check, the same grid the hosted scan console fills while a scan runs. `html-theme.ts` is the document shell shared with the hosted pages: the inlined stylesheet, theme boot and toggle, header and footer. The visual system itself comes from `packages/ui`, so the CLI's report and the web app look the same and change together. A report names the detected platform at the top and leaves out other platforms' checks. The JSON result keeps every check.
8. **`legal/` and `checks/legal/`** hold the legal signals ([decision 0015](decisions/0015-legal-signals.md)): 24 checks of a store's public legal disclosures, linked to 63 laws in `packages/catalog/data/legal/laws.json`. `legal/markets.ts` detects the markets a store sells to. `legal/run.ts` runs the legal checks after the readiness checks, on the same target and fetcher. `parsers/legal.ts` holds the official labels, register formats with their check digits and the vendor tables. The results land in the optional `legal` block of the result, never in `results`, the scores or the level. `reporters/legal.ts` renders them as a page, Markdown and JSON with the notice first. `withoutLegal` keeps them off public readiness exports.
9. **`resumable.ts`** has `startScan` and `continueScan`, which run one scan as steps for hosts with a time limit per request ([decision 0016](decisions/0016-resumable-scans.md)). Each step re-resolves the target and resumes the runner from the outcomes already decided. The `BudgetedFetcher` raises `StepDeadlineError` when the step's time is up, carries the counted requests and politeness state (pacing and back-off) between steps, and reads an optional `ResponseCache`. `scan()` and the steps share `assembleResult`.
10. **`scan.ts`** is the composition root: fetcher, target, runner, scoring, result. `onProgress` receives an event after each resolution phase and each check verdict (`progress.ts`). The hosted scanner streams these events to the home page's scan console.

## The result object

`packages/catalog/src/result.ts` defines the contract with Zod and exports it as JSON Schema (`dist/schema/scan-result.schema.json`). Its schema id is `agentic-readiness-scanner/1`. It carries:

- the schema id and the scanner, catalog and scoring versions
- the target with its platform and sampled pages
- the level with its next gate
- both dimension scores, their coverage, any ceiling in force, and one score per section
- one entry per check with verdict, evidence and fix
- scan warnings, and the optional `legal` block

Every consumer reads this object and nothing else. `target.platform` can gain values in later versions, so consumers treat an unknown value as `unknown`.

`packages/core/src/diff.ts` reduces a result to its comparable core (level, scores, score per section, verdict and skip reason per check) and compares two of them. Monitoring, the history tier and `agentic-readiness diff` all use it.

`packages/catalog/src/prompt.ts` composes the brief for a coding agent. It wraps the check's own `agent_prompt` (the task) in where the request comes from, what was observed, the specs behind the check, and fixed working rules (investigate first, fix the cause durably, verify, report). The HTML and Markdown reports and the MCP `get_fix` tool all use it, so every surface briefs agents the same way. `fixForPlatform` in the catalog adds a fix's `## On <platform>` note only when the scan detected that platform.

## Why the catalog is data

The engine, the docs generator, the knowledge base, the MCP tools, and anyone reading the published `catalog.json` and JSON Schemas all consume the check definitions and fixes. Keeping them as JSON and Markdown with a schema gives one source of truth that any language can read, and a reviewable diff when a check changes. It also gives the validator a hard rule to enforce: no check without a public spec URL, no check without a fix. See [decision 0003](decisions/0003-catalog-as-data.md).

## The hosted scanner

`apps/web/src` is a Hono application with no framework beyond that. Its parts:

- **`app.ts`** wires the discovery pages: the home page, `/health`, `/llms.txt`, the app's own robots.txt (with rules per crawler class), security.txt, the data-processing page, the MCP server card and the AI catalog. It mounts the route modules onto dependencies that are all interfaces: a `ResultStore` for scans, a `HistoryStore` for the durable per-host states ([decision 0009](decisions/0009-result-storage-tiers.md)), a `TargetRegistry` for the durable list of hosts, a `ProgressStore` for scans in flight, a `ScanLimiter` for host admission, a `ScanJobStore` for stepped scans, and a `MonitorStore` and a `Mailer` for monitoring.
- **`scan-service.ts`** classifies what was submitted (a root URL or a path) and runs or reuses a scan. It reserves the host atomically, lets a second root request join a scan already running, and caps concurrent steps. It is the one place that calls `startScan` and `continueScan`. Every hosted scan is a job in `jobs/` (a `ScanJobStore` with a lease per job and a per-job response cache) that runs one step per request ([decision 0017](decisions/0017-stepped-hosted-scans.md)). The next step is started by the page, by the app itself, by the hourly sweeper cron, or by the next request for the same root. `mcp-route.ts` serves the hosted MCP server through the same service.
- **`routes/report.ts`** serves the scan form (`POST /scan`), `/api/scan`, `/api/scan/stream` and `/api/scan/progress/:token`, `/sites/:host` (the stable profile of a root URL), `/r/:id` (an immutable snapshot), the legal-signal pages under both, `/h/:host` (history) and the badge.
- **`routes/jobs.ts`** serves the job status, the continue endpoint and the waiting page.
- **`routes/internal.ts`** serves the crons and the owner's exports. **`routes/monitor.ts`** serves monitoring signup, confirm and unsubscribe.
- **`knowledge/`** serves the knowledge base (`/knowledge-base`, the sitemap and `/llms-full.txt`), rendered from the articles in `packages/catalog/knowledge` with a small escaping Markdown renderer ([knowledge-base.md](knowledge-base.md)).
- **`hosts.ts`** keys hosts by dropping a leading `www.`, so `www.example.com` and `example.com` share one profile. **`scan-scope.ts`** decides which scans persist: only root URLs. **`rate-limit/`** holds the in-memory and atomic SQL admission limit, shared by root and path scans and by HTTP, MCP and monitoring. Only root scans write durable results and progress. See [decision 0014](decisions/0014-root-profiles-and-disposable-scans.md) for browser-only results, the minute limit, redirects and legacy history.
- **`handler.ts`** is the worker entry. It binds the SQL implementations to the Space's database (they share `store/sql-store.ts` for schema creation and row validation) and the mailer selected by `MAIL_PROVIDER`. **`dev.ts`** binds memory stores and a console mailer for Node.
- **`monitoring/service.ts`** holds the subscription lifecycle (signup, confirm, unsubscribe, the due run) with no HTTP in it ([decision 0006](decisions/0006-monitoring-by-weekly-rescan.md)). **`pages/*.ts`** render HTML from the `packages/ui` recipes.

See [hosting.md](hosting.md) for configuration, storage tables and deployment.

## The visual system

`packages/ui` follows the framework layer of the app-base UI standard and nothing above it ([decision 0008](decisions/0008-ui-standard.md)). It provides Tailwind CSS with the shadcn token contract (`src/theme.css`, `tailwind.config.ts`), class recipes transcribed from the standard's primitives (`src/recipes.ts`: button, badge, card, input, select, alert, textarea), lucide icons and self-hosted Inter. Its build compiles the stylesheet from the recipes, the report renderer and the hosted pages. It exports the stylesheet as a string that `htmlDocument` inlines, so a report written by the CLI is still one file. Class names are complete literals in those three places, and variants go through cva. There is no React, no Next.js and no component runtime.

The app's own TypeScript project (`tsconfig.app.json`) has no Node types, so a Node-only global in worker code fails the type-check. `dev.ts` and the tests live in `tsconfig.node.json`.

The shared document shell separates full-width navigation and hero surfaces from a readable inner grid. The Signal Network composition and motion rules live in `packages/ui/src/surfaces.css`, with the purple and lime palette in `theme.css`. Core's `siteHeader` and `pageHero` compose them for hosted pages and offline reports. The home page network is decorative and turns off under reduced motion. Compact heroes are static. The scan grid and radar keep their named transitions into the report's check map and level badge. Neither the palette nor the ambient animation changes scan state. See [the UI package guide](../packages/ui/README.md) for tokens, layout, accessibility and verification.

Hosted discovery and sharing metadata lives in `apps/web/src/metadata.ts`. Branded PNG cards are generated at build time from shared UI tokens and geometry, outside the worker. See [sharing-metadata.md](sharing-metadata.md) for schema entities, report indexing and retention, image maintenance and verification.

## Determinism

Given the same responses, a scan produces the same result. The product sample is seeded by hostname, checks run sequentially in a fixed order, and the result records the scanner, catalog and scoring versions. The fixture suite relies on this, and so does comparing two reports of the same store over time.

## Portability

`packages/core`, `packages/mcp` and `apps/web/src` use web-standard APIs only. Node-only helpers (reading fixtures from disk) live under `packages/core/src/testing`, on the separate export path `@agentic-readiness/core/testing`, so the worker bundle never pulls in `node:fs`.
