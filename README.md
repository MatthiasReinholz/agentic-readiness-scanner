# Agentic Readiness Scanner

Can an AI agent find, read, trust and buy from your store today?

The scanner answers that question for any public store URL. It reads public signals only, scores two dimensions (**agentic ingestion** and **agentic commerce**), gates them into a readiness level, and returns a shareable report in which every finding ships with a fix: a sentence, a snippet, and a prompt for a coding agent.

It is built WordPress-first, so it knows what a WooCommerce store exposes by default, and every check also runs against any other platform because every check reads public HTTP surfaces.

> Status: **0.7.0 released** (2026-11-02), hosted at <https://agentic-readiness-scanner.space.fast/>. The catalog was audited against every documented crawler, standard and comparable scanner on 2026-10-31 ([the audit](docs/audits/2026-10-31-check-audit.md)) and against the conventional technical SEO that AI answers inherit ([the technical SEO audit](docs/audits/2026-11-01-technical-seo-audit.md)); `main` carries catalog 0.4.0 after a third audit that read reports as a store owner does and scanned fifteen real stores ([the report and accuracy audit](docs/audits/2026-11-01-report-and-accuracy-audit.md)): reports lead with what to do, and a page the scanner did not read is never scored. The recorded WooCommerce store reaches Level 5. `@agentic-readiness/cli` and `@agentic-readiness/core` are on npm since 0.7.0. See [Roadmap](#roadmap).

## What it checks

64 checks in nine groups, each with one question, one verdict, evidence, and a fix. Full table: [docs/checks.md](docs/checks.md). Three rules set it apart from most readiness tests: crawlers are evaluated by what their operator documents them for, so a decision to block AI training never costs points while blocking the crawlers behind AI answers does; the scanner identifies itself on every request and never impersonates an agent; and conventions without a documented consumer (llms.txt among them) are validated when present but never required. Conventional technical SEO is covered where a vendor documents that an AI surface depends on it (indexability, snippet eligibility, canonicals, redirects, the 2 MB cutoff, titles) and refused where none does (length rules, Core Web Vitals, favicons, Open Graph).

| Dimension         | Groups                                                                                                                                      |
| ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| Agentic ingestion | A1 Discoverability · A2 Bot access control · A3 Content accessibility · A4 Protocol discovery                                               |
| Agentic commerce  | B1 Catalog exposure · B2 Product structured data · B3 Product identity · B4 Merchant trust and policies · B5 Checkout and payment protocols |

Scores are 0 to 100 per dimension. The level (0 Not reachable to 5 Transactable) is gated, not averaged: a store holds a level only when every blocking check of that level passes. The report leads with the level, the checks standing between the store and the next one, and an ordered list of what to fix first, next and when it fits (weight 3 blocking, 2 expected, 1 nice to have); a check the scanner could not answer is skipped, never failed. Details: [docs/scoring.md](docs/scoring.md).

## Use it

### Hosted

The hosted scanner runs at <https://agentic-readiness-scanner.space.fast/> on [Spacefast](https://spacefast.com/). Submit a URL and get a report page, or use it as an agent:

```bash
curl -X POST https://agentic-readiness-scanner.space.fast/api/scan -H 'content-type: application/json' -d '{"url":"https://example.com"}'
```

Root-URL scans have a public profile at `/sites/<host>` showing the latest report; use `/report.json` or `/report.md` beneath that profile for exports. Each scan also keeps its immutable `/r/<id>` snapshot (`.json` and `.md`) until retention expires. During root scans the page shows live phases and verdicts, also served by `POST /api/scan/stream`. A submitted path, query or non-default port runs once: the browser receives the report directly, and the API/MCP returns the result without saved report/profile links. No result, history, target, monitoring or progress record is saved for that scan. This remains a site scan started from that URL, including origin-wide signals and sampled pages. Across all paths and interfaces, a host can start at most one new scan per minute; cached root results may replay without fetching. See [the scope policy](docs/decisions/0014-root-profiles-and-disposable-scans.md).

After a root scan, `GET /badge/<host>.svg` renders a badge and `/h/<host>` (or `/h/<host>.json`) shows recorded states and changes. A profile retains recorded history after its detailed report expires. The app advertises an MCP server at `/mcp` with its server card at `/mcp/server-card`, listed in `/.well-known/ai-catalog.json`.

The [knowledge base](https://agentic-readiness-scanner.space.fast/knowledge-base) explains every check in its own article: what it looks at, why agents care, how the scanner decides and how to fix it. Each article is also Markdown (append `.md`), and `/llms-full.txt` has all of them in one file. Hosts are keyed without `www.`, so `www.example.com` and `example.com` share one cooldown, history and badge.

When the deployment has a mail provider configured, a root-URL report can also be **monitored**: leave an email address, confirm it, and the scanner rescans the host weekly and writes only when the level, a score or a check result changed. Double opt-in, one-click unsubscribe, nothing else done with the address ([decision 0006](docs/decisions/0006-monitoring-by-weekly-rescan.md)).

### Command line

Two packages are on npm ([decision 0013](docs/decisions/0013-two-published-packages.md)): `@agentic-readiness/cli`, the command line with the local MCP server inside, and `@agentic-readiness/core`, the engine as a library. Both are self-contained and published with provenance from the release workflow.

```bash
npx @agentic-readiness/cli scan https://example.com
```

```bash
npx @agentic-readiness/cli scan https://example.com --format json --output report.json
```

Formats: `md` (default), `json`, `html`, `badge`. `npx @agentic-readiness/cli diff before.json after.json` compares two saved JSON reports and exits 3 when anything changed, for pipelines. Options: `--profile <id>` overrides detection, `--budget <n>` caps requests (default 40), `--sample <n>` sets how many product pages are sampled, `--timeout <ms>` per request, `--fixture <dir>` answers from a recorded store for offline runs, `--output <file>` writes instead of printing. `npx @agentic-readiness/cli help` prints the full usage. From a checkout, `pnpm scan` runs the same CLI after `pnpm install && pnpm build`.

### MCP

Over stdio for local coding agents (Claude Code, Cursor, Claude Desktop): add a server whose command is

```bash
npx -y @agentic-readiness/cli mcp
```

Tools: `scan_store(url, profile?, format?)`, `get_fix(check_id)`, `list_checks()`. The hosted app exposes the same tools over Streamable HTTP at `/mcp`, plus `get_history(host)` and `explain_check(check_id)`, which returns the knowledge-base article.

### As a library

```ts
import { scan, renderMarkdown } from '@agentic-readiness/core';

const result = await scan('https://example.com');
console.log(result.level, result.scores);
console.log(renderMarkdown(result));
```

The engine uses web-standard APIs only (fetch, Request, Response), so it runs in Node, in workers and in tests. The published `@agentic-readiness/core` carries the catalog and the visual system inside it, so it needs nothing else from this repository; `@agentic-readiness/core/testing` adds the fixture fetcher for offline runs.

## How it works

One engine, three hosts. Nothing in a check knows where it runs.

```text
packages/catalog   the catalog as data: checks, levels, profiles, fixes, result schema (private, bundled into core and cli)
packages/core      fetcher, target resolver, parsers, checks, runner, scoring, reporters (published: @agentic-readiness/core)
packages/ui        visual system: Tailwind tokens, compiled stylesheet, class recipes, icons (private, bundled)
packages/mcp       MCP server definition (tools), shared by CLI and hosted app (private, bundled into cli)
packages/cli       agentic-readiness scan | mcp | catalog (published: @agentic-readiness/cli, self-contained)
apps/web           Hono app: form, reports, badge, API, MCP endpoint, monitoring; runs on Spacefast Functions
fixtures/stores    recorded stores for deterministic tests
docs/              architecture, scoring, checks (generated), hosting, security model, release process, decisions
```

Design rules that every change must respect:

- **Public signals only, honestly fetched.** Nothing needs credentials; every request identifies the scanner and no request impersonates another agent ([decision 0010](docs/decisions/0010-honest-fetch.md)).
- **The catalog is data.** A check's title, weight, dependencies, spec URLs and fix live in `packages/catalog`, not in code. A check without a public spec URL does not ship.
- **One check, one question, one fix.** Implementations produce a verdict and evidence; the runner skips dependents of failed checks; unimplemented checks say so.
- **Deterministic.** Product pages are sampled with a seed derived from the hostname; checks run in a fixed order; the result records catalog and scoring versions so two reports can be compared.
- **Agent-first output.** JSON and Markdown before HTML, and the scanner itself is an MCP tool.

More in [docs/architecture.md](docs/architecture.md).

## Develop

Requirements: Node 24 (see `.nvmrc`) and pnpm 10.

```bash
pnpm install
```

```bash
pnpm check
```

`pnpm check` is what CI runs: repository hygiene, formatting, Markdown lint, build, lint, type-check, tests, catalog validation and generated-docs parity. Install the pre-push hook once with `pnpm hooks:install` so it runs before every push.

Other commands:

- `pnpm dev` starts the hosted app on <http://localhost:8787> with an in-memory result store.
- `pnpm scan https://example.com` runs the CLI from the workspace.
- `pnpm docs:generate` regenerates `docs/checks.md` from the catalog.

To add a check, read [CONTRIBUTING.md](CONTRIBUTING.md). To understand the hosting constraints that shaped the stack, read [docs/hosting.md](docs/hosting.md) and the decisions in [docs/decisions](docs/decisions).

## Roadmap

- **0.1** (released): catalog, engine, 19 checks, CLI, MCP, hosted app with badge and monitoring, CI and release automation.
- **0.2** (released): per-section scores, agent briefs, monitoring by weekly rescan, the shared visual system.
- **0.3** (on `main`): the audited catalog 0.2.0 with purpose-classed crawler checks, honest fetching, corrected protocol discovery and Shopify checks, every check implemented; per-host history and the CLI `diff`; npm publication.
- **1.0**: a recorded reference store per platform with a nightly diff, Web Bot Auth signing for the scanner's own requests, and the result contract declared stable.

## Related work

[Cloudflare's Is It Agent Ready](https://isitagentready.com/) covers the agent-protocol layer for any site; [Shopify's product-page audit](https://www.shopify.com/agentic-readiness) and the [Shopware and Agentic Commerce Alliance scanner](https://scanner.agentic-commerce.org/) cover storefronts; Lumar, Semrush, Ahrefs and a dozen open-source tools cover parts of both. The [check audit](docs/audits/2026-10-31-check-audit.md) compares them check by check. This project combines both layers, reads the store the way a shopping agent does (platform API, structured data, feeds, policies), keeps a public history per host, and is open source.

## License

GPL-3.0-or-later. See [LICENSE](LICENSE).

This is an independent open-source project. It is not an Automattic, WordPress or WooCommerce product.
