# Agentic Readiness Scanner

Can an AI agent find, read, trust and buy from your store today?

The scanner answers that question for any public store URL. It reads public signals only, scores two dimensions (**agentic ingestion** and **agentic commerce**), gates them into a readiness level, and returns a shareable report in which every finding ships with a fix: a sentence, a snippet, and a prompt for a coding agent.

It is built WordPress-first, so it knows what a WooCommerce store exposes by default and what the companion plugin can fix in one click. Every check also runs against any other platform, because every check runs against public HTTP surfaces.

> Status: **pre-release scaffold.** The architecture, catalog, result contract, CLI, MCP server and hosted app are in place. 19 of the 55 catalog checks are implemented; the rest are reported as _not implemented_ rather than guessed. See [Roadmap](#roadmap).

## What it checks

55 checks in nine groups, each with one question, one verdict, evidence, and a fix. Full table: [docs/checks.md](docs/checks.md).

| Dimension         | Groups                                                                                                                                      |
| ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| Agentic ingestion | A1 Discoverability · A2 Bot access control · A3 Content accessibility · A4 Protocol discovery                                               |
| Agentic commerce  | B1 Catalog exposure · B2 Product structured data · B3 Product identity · B4 Merchant trust and policies · B5 Checkout and payment protocols |

Scores are 0 to 100 per dimension. The level (0 Not reachable to 5 Transactable) is gated, not averaged: a store holds a level only when every blocking check of that level passes. The report leads with the level and the one thing standing between the store and the next one. Details: [docs/scoring.md](docs/scoring.md).

## Use it

### Hosted

The hosted scanner runs on [Spacefast](https://spacefast.com/). Submit a URL and get a report page, or use it as an agent:

```bash
curl -X POST https://<your-space>/api/scan -H 'content-type: application/json' -d '{"url":"https://example.shop"}'
```

Every report is also available as `.json` and `.md`, and `GET /badge/<host>.svg` renders a badge for a README or footer. The app advertises an MCP server at `/.well-known/mcp/server-card.json` with Streamable HTTP at `/mcp`.

A report can also be **monitored**: leave an email address, confirm it, and the scanner rescans the host weekly and writes only when the level, a score or a check result changed. Double opt-in, one-click unsubscribe, nothing else done with the address ([decision 0006](docs/decisions/0006-monitoring-by-weekly-rescan.md)).

### Command line

```bash
npx @agentic-readiness/cli scan https://example.shop
```

```bash
npx @agentic-readiness/cli scan https://example.shop --format json --output report.json
```

Formats: `md` (default), `json`, `html`, `badge`. `--profile` overrides detection, `--budget` caps requests (default 40), `--fixture <dir>` answers from a recorded store for offline runs.

### MCP

Over stdio for local agents:

```bash
npx @agentic-readiness/cli mcp
```

Tools: `scan_store(url, profile?, format?)`, `get_fix(check_id)`, `list_checks()`. The hosted app exposes the same tools over Streamable HTTP.

### As a library

```ts
import { scan, renderMarkdown } from '@agentic-readiness/core';

const result = await scan('https://example.shop');
console.log(result.level, result.scores);
console.log(renderMarkdown(result));
```

The engine uses web-standard APIs only (fetch, Request, Response), so it runs in Node, in workers and in tests.

## How it works

One engine, three hosts. Nothing in a check knows where it runs.

```text
packages/catalog   the catalog as data: checks, levels, profiles, fixes, result schema
packages/core      fetcher, target resolver, parsers, checks, runner, scoring, reporters
packages/mcp       MCP server definition (tools), shared by CLI and hosted app
packages/cli       agentic-readiness scan | mcp | catalog
apps/web           Hono app: form, reports, badge, API, MCP endpoint, monitoring; runs on Spacefast Functions
fixtures/stores    recorded stores for deterministic tests
docs/              architecture, scoring, hosting, security model, release process, decisions
```

Design rules that every change must respect:

- **Public signals only.** Nothing needs credentials; nothing is stored beyond the report.
- **The catalog is data.** A check's title, weight, dependencies, spec URLs and fix live in `packages/catalog`, not in code. A check without a public spec URL does not ship.
- **One check, one question, one fix.** Implementations produce a verdict and evidence; the runner skips dependents of failed checks; unimplemented checks say so.
- **Deterministic.** Product pages are sampled with a seed derived from the hostname; checks run in a fixed order; the result records catalog and scoring versions so two reports can be compared.
- **Agent-first output.** JSON and Markdown before HTML, and the scanner itself is an MCP tool.

More in [docs/architecture.md](docs/architecture.md).

## Companion plugin

A WordPress plugin, maintained in its own repository, turns findings into fixes: it reads the public report, runs the full-catalog product identity audit from inside WordPress, and applies the fixes marked **auto** in the catalog (llms.txt, robots rules, Content Signals, Markdown negotiation, Product JSON-LD, identifiers, policy pages, security.txt, UCP manifest). The contract between this repository and the plugin is described in [docs/companion-plugin.md](docs/companion-plugin.md).

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
- `pnpm scan https://example.shop` runs the CLI from the workspace.
- `pnpm docs:generate` regenerates `docs/checks.md` from the catalog.

To add a check, read [CONTRIBUTING.md](CONTRIBUTING.md). To understand the hosting constraints that shaped the stack, read [docs/hosting.md](docs/hosting.md) and the decisions in [docs/decisions](docs/decisions).

## Roadmap

- **0.1** (this scaffold): catalog, engine, 19 checks, CLI, MCP, hosted app, CI and release automation.
- **0.2**: remaining ingestion checks (agent-profile comparison, Markdown negotiation, Link headers, protocol discovery), nightly reference-store diff.
- **0.3**: remaining commerce checks (feeds, identity per channel, UCP and ACP), public hosted launch, badge.
- **1.0**: companion plugin on WordPress.org with one-click fixes.

## Related work

[Cloudflare's Is It Agent Ready](https://isitagentready.com/) covers the web-standards layer for any site; [Shopify](https://community.shopify.com/t/shopify-launched-a-free-agentic-commerce-readiness-scanner-here-is-what-it-found-and-what-to-do-next/614767) and [Shopware](https://forum.shopware.com/t/fragen-zum-agentic-readiness-scanner/109670) ship platform-specific scanners. This project combines both layers, reads the store the way a shopping agent does (Store API, structured data, feeds), and is open source.

## License

GPL-3.0-or-later. See [LICENSE](LICENSE).

This is an independent open-source project. It is not an Automattic, WordPress or WooCommerce product.
