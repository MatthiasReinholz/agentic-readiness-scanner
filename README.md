# Agentic Readiness Scanner

Can an AI agent find, read, trust and buy from your store today?

The scanner answers that question for any public store URL. It reads public signals only, scores two dimensions (**agentic ingestion** and **agentic commerce**), gates them into a readiness level, and returns a shareable report in which every finding ships with a fix: a sentence, a snippet, and a prompt for a coding agent.

It is built WordPress-first, so it knows what a WooCommerce store exposes by default, and every check also runs against any other platform because every check reads public HTTP surfaces.

> Status: **0.1.0 released** (2026-10-31), hosted at <https://agentic-readiness-scanner.space.fast/>. 19 of the 55 catalog checks are implemented; the rest are reported as _not implemented_ rather than guessed. Two level gates (B3.6 and B5.1/B5.3) are among the unimplemented checks, so the highest level a store can reach today is **2**. The npm packages are not published yet. See [Roadmap](#roadmap).

## What it checks

55 checks in nine groups, each with one question, one verdict, evidence, and a fix. Full table: [docs/checks.md](docs/checks.md).

| Dimension         | Groups                                                                                                                                      |
| ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| Agentic ingestion | A1 Discoverability · A2 Bot access control · A3 Content accessibility · A4 Protocol discovery                                               |
| Agentic commerce  | B1 Catalog exposure · B2 Product structured data · B3 Product identity · B4 Merchant trust and policies · B5 Checkout and payment protocols |

Scores are 0 to 100 per dimension. The level (0 Not reachable to 5 Transactable) is gated, not averaged: a store holds a level only when every blocking check of that level passes. The report leads with the level and the one thing standing between the store and the next one. Details: [docs/scoring.md](docs/scoring.md).

## Use it

### Hosted

The hosted scanner runs at <https://agentic-readiness-scanner.space.fast/> on [Spacefast](https://spacefast.com/). Submit a URL and get a report page, or use it as an agent:

```bash
curl -X POST https://agentic-readiness-scanner.space.fast/api/scan -H 'content-type: application/json' -d '{"url":"https://example.com"}'
```

Every report is also available as `.json` and `.md`. After a host has been scanned, `GET /badge/<host>.svg` renders a badge for a README or footer. The app advertises an MCP server at `/.well-known/mcp/server-card.json` with Streamable HTTP at `/mcp`.

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

Formats: `md` (default), `json`, `html`, `badge`. Options: `--profile <id>` overrides detection, `--budget <n>` caps requests (default 40), `--sample <n>` sets how many product pages are sampled, `--timeout <ms>` per request, `--fixture <dir>` answers from a recorded store for offline runs, `--output <file>` writes instead of printing. `pnpm scan help` prints the full usage.

### MCP

Over stdio for local agents, from the same checkout:

```bash
pnpm --filter @agentic-readiness/cli exec agentic-readiness mcp
```

Tools: `scan_store(url, profile?, format?)`, `get_fix(check_id)`, `list_checks()`. The hosted app exposes the same tools over Streamable HTTP at `/mcp`.

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

- **Public signals only.** Nothing needs credentials; nothing is stored beyond the report.
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
- **0.2**: remaining ingestion checks (agent-profile comparison, Markdown negotiation, Link headers, protocol discovery) and B3.6 so Level 3 becomes reachable; npm publication.
- **0.3**: remaining commerce checks (feeds, identity per channel, UCP and ACP) so Level 5 becomes reachable; nightly reference-store diff.
- **1.0**: the full catalog implemented and the result contract declared stable.

## Related work

[Cloudflare's Is It Agent Ready](https://isitagentready.com/) covers the web-standards layer for any site; [Shopify](https://community.shopify.com/t/shopify-launched-a-free-agentic-commerce-readiness-scanner-here-is-what-it-found-and-what-to-do-next/614767) and [Shopware](https://forum.shopware.com/t/fragen-zum-agentic-readiness-scanner/109670) ship platform-specific scanners. This project combines both layers, reads the store the way a shopping agent does (Store API, structured data, feeds), and is open source.

## License

GPL-3.0-or-later. See [LICENSE](LICENSE).

This is an independent open-source project. It is not an Automattic, WordPress or WooCommerce product.
