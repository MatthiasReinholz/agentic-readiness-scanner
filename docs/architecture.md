# Architecture

One engine, three hosts. The hosted app, the CLI and the MCP server all call the same `scan` function; nothing in a check knows where it runs.

```text
                    ┌──────────────────────┐
                    │  packages/catalog    │  checks, levels, profiles, fixes, result schema (data)
                    └──────────┬───────────┘
                               │
                    ┌──────────▼───────────┐   ┌──────────────────┐
                    │  packages/core       │◄──│  packages/ui     │  tokens, compiled stylesheet, class recipes, icons
                    └───┬──────────┬───────┘   └────────▲─────────┘
                        │          │                    │ (also used by apps/web)
                        │          │
          ┌─────────────▼──┐   ┌───▼──────────────┐
          │ packages/mcp   │   │ packages/cli      │  scan | mcp (stdio) | catalog
          └─────────┬──────┘   └──────────────────┘
                    │
          ┌─────────▼──────┐
          │ apps/web       │  Hono: form, /api/scan, /r/:id(.json|.md), /badge, /mcp, /llms.txt
          └────────────────┘  runs on Spacefast Functions (worker) and on Node for development
```

## Layers in `packages/core`

1. **`http/`** The `Fetcher` interface and two implementations. `BudgetedFetcher` wraps the platform `fetch` and enforces the request budget, timeouts, body size cap, redirect limit and the URL policy; every response is cached per scan so two checks never fetch the same URL twice. `FixtureFetcher` answers from a recorded map for tests and offline runs.
2. **`target/`** `resolveTarget` turns user input into a `Target`: canonical origin, detected platform, selected profile, parsed robots.txt, discovered sitemap, and a deterministic sample of product and policy pages. Sampling is seeded by hostname.
3. **`parsers/`** Pure, fixture-tested parsers: robots.txt (RFC 9309 plus the Content-Signal, Content-Usage and License lines), sitemaps with lastmod, HTML helpers, JSON-LD, llms.txt, Link headers, product feeds, GTIN check digits, security.txt. Checks never parse anything themselves.
4. **`checks/`** One `Check` per catalog id: `run(context)` returns a verdict, a message and evidence. The context carries the target, the fetcher, the catalog definition and the outcomes of earlier checks. `registry.ts` lists what is implemented; `crawlers.ts` holds the documented crawler tokens by class (training, search, user-triggered), which the access checks and the hosted app's own robots.txt share. Each check is unit-tested per verdict branch with `mapFetcher`, `targetFor` and `runCheck` from `testing/check-harness.ts`, so a branch never needs a recorded store.
5. **`runner.ts`** Orders checks by dependency, skips checks that do not apply to the profile or platform, skips dependents of failed checks, marks unimplemented checks honestly, and stops on budget exhaustion. Results come back in catalog order.
6. **`scoring.ts`** Pure functions: dimension scores (weighted pass ratio, warn counts half, skips drop out of the denominator) and the gated level with its next gate.
7. **`reporters/`** JSON, Markdown, HTML and SVG badge, all from the same result object. None touches the network. `priorities.ts` orders open findings (next gate first, then tier from the catalog weight, then fail before warn) and every surface renders that one list; `shared.ts` holds the scope note that says what a scan did and did not do. `html-theme.ts` is the document shell shared with the hosted pages (the inlined stylesheet, theme boot and toggle, header and footer chrome); the visual system itself comes from `packages/ui`, so the CLI's report and the web app look the same and change together.
8. **`scan.ts`** The composition root: fetcher, target, runner, scoring, result.

## The result object

`packages/catalog/src/result.ts` defines the contract with Zod and exports it as JSON Schema (`dist/schema/scan-result.schema.json`). It carries the schema id, catalog and scoring versions, the target with its sampled pages, the level with its next gate, both dimension scores plus one per group, one entry per check with verdict, evidence and fix, and scan warnings. Every consumer reads this object and nothing else.

`packages/core/src/diff.ts` reduces a result to its comparable core (level, scores, score per group, verdict and skip reason per check) and compares two of them; monitoring and the history tier both use it.

`packages/catalog/src/prompt.ts` composes the brief a merchant hands to a coding agent: the check's own `agent_prompt` (the task) wrapped in where the request comes from, what was observed, the specs behind the check, and fixed working rules (investigate first, fix the cause durably, verify, report). The HTML and Markdown reports and the MCP `get_fix` tool all use it, so every surface briefs agents the same way.

## Why the catalog is data

Check definitions and fixes are consumed by the engine, the docs generator, the MCP tools, and by anyone reading the published `catalog.json` and JSON Schemas. Keeping them as JSON and Markdown with a schema means one source of truth that any language can read, a reviewable diff when a check changes, and a hard rule the validator can enforce: no check without a public spec URL, no check without a fix. See [decisions/0003](decisions/0003-catalog-as-data.md).

## The hosted app

`apps/web/src` is a Hono application with no framework beyond that. `app.ts` wires the discovery pages (including the app's own MCP server card, AI catalog and class-aware robots.txt) and mounts the route modules onto dependencies that are all interfaces: a `ResultStore` for scans, a `HistoryStore` for the durable per-host states ([decisions/0009](decisions/0009-result-storage-tiers.md)), a `TargetRegistry` for the durable list of hosts, a `MonitorStore` and a `Mailer` for monitoring. `scan-service.ts` runs or reuses a scan (per-host cooldown, shared in-flight scans, the concurrency cap) and is the one place that calls `scan`; `routes/report.ts` serves the form, `/api/scan`, `/r/:id`, `/h/:host` (history) and the badge; `routes/internal.ts` the crons and the owner's exports; `routes/monitor.ts` signup, confirm and unsubscribe. `handler.ts` binds the SQL implementations (which share `store/sql-store.ts` for schema creation and row validation) to the Space's database and the mailer selected by `MAIL_PROVIDER` (Brevo in production) for the worker; `dev.ts` binds memory stores and a console mailer for Node. `monitoring/service.ts` holds the subscription lifecycle (signup, confirm, unsubscribe, the due-run) with no HTTP in it, and `pages/*.ts` render HTML from the `packages/ui` recipes. See [decisions/0006](decisions/0006-monitoring-by-weekly-rescan.md).

## The visual system

`packages/ui` follows the app-base UI standard's framework layer and nothing above it ([decisions/0008](decisions/0008-ui-standard.md)): Tailwind CSS with the shadcn token contract (`src/theme.css`, `tailwind.config.ts`), class recipes transcribed from its primitives (`src/recipes.ts`: button, badge, card, input, select, alert, textarea), lucide icons and self-hosted Inter. Its build compiles the stylesheet from the recipes, the report renderer and the hosted pages, and exports it as a string that `htmlDocument` inlines, so a report written by the CLI is still one file. Class names are complete literals in those three places; variants go through cva. There is no React, no Next.js and no component runtime.

The app's own TypeScript project (`tsconfig.app.json`) has no Node types, so a Node-only global in worker code fails the type-check; `dev.ts` and the tests live in `tsconfig.node.json`.

## Determinism

Given the same responses, a scan produces the same result: the product sample is seeded by hostname, checks run sequentially in a fixed order, and the result records catalog, scoring and scanner versions. The fixture suite relies on this, and so does comparing two reports of the same store over time.

## Portability

`packages/core`, `packages/mcp` and `apps/web/src` use web-standard APIs only. Node-only helpers (reading fixtures from disk) live under `packages/core/src/testing` on a separate export path, so the worker bundle never pulls in `node:fs`.
