# Architecture

One engine, three hosts. The hosted app, the CLI and the MCP server all call the same `scan` function; nothing in a check knows where it runs.

```text
                    ┌──────────────────────┐
                    │  packages/catalog    │  checks, levels, profiles, fixes, result schema (data)
                    └──────────┬───────────┘
                               │
                    ┌──────────▼───────────┐
                    │  packages/core       │  Fetcher → Target → Checks → Runner → Scoring → Reporters
                    └───┬──────────┬───────┘
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
3. **`parsers/`** Pure, fixture-tested parsers: robots.txt (RFC 9309 plus Content-Signal), sitemaps, HTML helpers, JSON-LD, llms.txt, GTIN check digits, security.txt. Checks never parse anything themselves.
4. **`checks/`** One `Check` per catalog id: `run(context)` returns a verdict, a message and evidence. The context carries the target, the fetcher, the catalog definition and the outcomes of earlier checks. `registry.ts` lists what is implemented.
5. **`runner.ts`** Orders checks by dependency, skips checks that do not apply to the profile or platform, skips dependents of failed checks, marks unimplemented checks honestly, and stops on budget exhaustion. Results come back in catalog order.
6. **`scoring.ts`** Pure functions: dimension scores (weighted pass ratio, warn counts half, skips drop out of the denominator) and the gated level with its next gate.
7. **`reporters/`** JSON, Markdown, HTML and SVG badge, all from the same result object. None touches the network.
8. **`scan.ts`** The composition root: fetcher, target, runner, scoring, result.

## The result object

`packages/catalog/src/result.ts` defines the contract with Zod and exports it as JSON Schema (`dist/schema/scan-result.schema.json`). It carries the schema id, catalog and scoring versions, the target with its sampled pages, the level with its next gate, both scores, one entry per check with verdict, evidence and fix, and scan warnings. Every consumer reads this object and nothing else.

## Why the catalog is data

Check definitions and fixes are consumed by the engine, the docs generator, the MCP tools and the WordPress companion plugin (PHP). Keeping them as JSON and Markdown with a schema means one source of truth across languages, a reviewable diff when a check changes, and a hard rule the validator can enforce: no check without a public spec URL, no check without a fix. See [decisions/0003](decisions/0003-catalog-as-data.md).

## Determinism

Given the same responses, a scan produces the same result: the product sample is seeded by hostname, checks run sequentially in a fixed order, and the result records catalog, scoring and scanner versions. The fixture suite relies on this, and so does comparing two reports of the same store over time.

## Portability

`packages/core`, `packages/mcp` and `apps/web/src` use web-standard APIs only. Node-only helpers (reading fixtures from disk) live under `packages/core/src/testing` on a separate export path, so the worker bundle never pulls in `node:fs`.
