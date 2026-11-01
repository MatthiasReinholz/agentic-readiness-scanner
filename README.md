# Agentic Readiness Scanner

Can an AI agent find, read, trust and buy from your store today?

The scanner answers that question for any public store URL. It reads public signals only, scores two dimensions (**agentic ingestion** and **agentic commerce**), gates them into a readiness level, and returns a shareable report in which every finding ships with a fix: a sentence, a snippet, and a prompt for a coding agent.

It is built WordPress-first, so it knows what a WooCommerce store exposes by default, and every check also runs against any other platform because every check reads public HTTP surfaces.

> Status: **0.4.0 released** (2026-11-01), hosted at <https://agentic-readiness-scanner.space.fast/>. The catalog was audited against every documented crawler, standard and comparable scanner on 2026-10-31 ([the audit](docs/audits/2026-10-31-check-audit.md)) and against the conventional technical SEO that AI answers inherit ([the technical SEO audit](docs/audits/2026-11-01-technical-seo-audit.md)); `main` carries catalog 0.4.0 after a third audit that read reports as a store owner does and scanned fifteen real stores ([the report and accuracy audit](docs/audits/2026-11-01-report-and-accuracy-audit.md)): reports lead with what to do, and a page the scanner did not read is never scored. The recorded WooCommerce store reaches Level 5. The npm packages are not published yet. See [Roadmap](#roadmap).

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

Every report is also available as `.json` and `.md`. After a host has been scanned, `GET /badge/<host>.svg` renders a badge for a README or footer, and `/h/<host>` (or `/h/<host>.json`) shows every distinct state the host was observed in and what changed between them; each report says what changed since the previous state. The app advertises an MCP server at `/mcp` with its server card at `/mcp/server-card`, listed in `/.well-known/ai-catalog.json`.

When the deployment has a mail provider configured, a report can also be **monitored**: leave an email address, confirm it, and the scanner rescans the host weekly and writes only when the level, a score or a check result changed. Double opt-in, one-click unsubscribe, nothing else done with the address ([decision 0006](docs/decisions/0006-monitoring-by-weekly-rescan.md)).

### Command line

The packages are not on npm yet (the `@agentic-readiness/*` names are reserved for them), so run the CLI from a checkout:

```bash
git clone https://github.com/MatthiasReinholz/agentic-readiness-scanner.git && cd agentic-readiness-scanner && pnpm install && pnpm build
```

```bash
pnpm scan https://example.com
```

```bash
pnpm scan https://example.com --format json --output report.json
```

Formats: `md` (default), `json`, `html`, `badge`. `pnpm scan diff before.json after.json` compares two saved JSON reports and exits 3 when anything changed, for pipelines. Options: `--profile <id>` overrides detection, `--budget <n>` caps requests (default 40), `--sample <n>` sets how many product pages are sampled, `--timeout <ms>` per request, `--fixture <dir>` answers from a recorded store for offline runs, `--output <file>` writes instead of printing. `pnpm scan help` prints the full usage.

### MCP

Over stdio for local agents, from the same checkout:

```bash
pnpm --filter @agentic-readiness/cli exec agentic-readiness mcp
```

Tools: `scan_store(url, profile?, format?)`, `get_fix(check_id)`, `list_checks()`. The hosted app exposes the same tools over Streamable HTTP at `/mcp`, plus `get_history(host)`.

### As a library

```ts
import { scan, renderMarkdown } from '@agentic-readiness/core';

const result = await scan('https://example.com');
console.log(result.level, result.scores);
console.log(renderMarkdown(result));
```

The engine uses web-standard APIs only (fetch, Request, Response), so it runs in Node, in workers and in tests. Until the packages are published, consume them through the workspace.

## How it works

One engine, three hosts. Nothing in a check knows where it runs.

```text
packages/catalog   the catalog as data: checks, levels, profiles, fixes, result schema
packages/core      fetcher, target resolver, parsers, checks, runner, scoring, reporters
packages/ui        visual system: Tailwind tokens, compiled stylesheet, class recipes, icons (after the app-base UI standard)
packages/mcp       MCP server definition (tools), shared by CLI and hosted app
packages/cli       agentic-readiness scan | mcp | catalog
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
