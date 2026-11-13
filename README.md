# Agentic Readiness Scanner

Can an AI agent find, read, trust and buy from your store today?

AI agents increasingly shop on a person's behalf. They search for products, compare offers and, more and more, place the order. This is called agentic commerce. An agent does not look at your store the way a person does. It reads robots.txt (the file that tells crawlers what they may fetch), sitemaps, the structured data in your pages, your policies and the protocols your store advertises. If those are missing, blocked or wrong, the agent skips your store and recommends another one.

The scanner tells you how your store looks to such an agent. You give it a public store URL. It reads only what any visitor could read, runs 86 checks, gives the store a readiness level and two scores, and returns a report in which every finding comes with a fix.

> Status: version **0.16.0** (catalog 0.11.1, scoring 0.8.0), released 2026-11-05. The hosted scanner runs at <https://agentic-readiness-scanner.space.fast/>. `@agentic-readiness/cli` and `@agentic-readiness/core` are on npm. See the [roadmap](#roadmap) and the [changelog](CHANGELOG.md).

## What it checks

86 checks in 9 sections. Each check asks one question, returns one verdict (pass, warn, fail or skip) with evidence, and links one fix. The full list is in [docs/checks.md](docs/checks.md).

| Score           | What it asks                                      | Sections                                                                         |
| --------------- | ------------------------------------------------- | -------------------------------------------------------------------------------- |
| Visible to AI   | Can AI find and read your site?                   | A1 Findable · A2 Open to AI · A3 Readable · A4 Connectable                       |
| Shoppable by AI | Can AI understand, trust and buy from your store? | B1 Browsable · B2 Well described · B3 Identifiable · B4 Trustworthy · B5 Buyable |

Each section has a plain name and the question it answers, such as "Findable: can AI find your site and products?". The technical names (A1 Discoverability, B3 Product identity and so on) stay in the detailed results and in the JSON, where the two scores are called `ingestion` and `commerce`.

Examples: does robots.txt let the crawlers behind AI answers read product pages (A2.2)? Is the price in the HTML, or only shown after JavaScript runs (A3.2)? Does each product carry a GTIN, the global barcode number (B3.1)? Can an agent find the return policy (B4.1)? Does the store advertise a checkout an agent can use, such as a UCP profile (Universal Commerce Protocol, an open standard for agents to discover and buy from stores) with a checkout capability (B5.2)?

Three rules set the scanner apart from most readiness tests:

- **Crawlers are judged by what their operator says they do.** Blocking AI training crawlers never costs points. Blocking the crawlers behind AI answers and search does.
- **The scanner is honest about itself.** It names itself on every request and never pretends to be another agent.
- **Only conventions with a documented consumer count.** A file such as llms.txt is checked when present but never required, because no consumer of it is documented.

Conventional technical SEO is covered only where a vendor documents that an AI surface depends on it: indexability, snippet eligibility, canonicals, redirects, the 2 MB page cutoff and titles. Length rules, Core Web Vitals, favicons and Open Graph are not scored ([decision 0011](docs/decisions/0011-technical-seo-scope.md)).

### Platforms

The general checks run on any store, because they read public web pages and files. The scanner also recognises 13 platforms: WordPress, WooCommerce, Shopify, BigCommerce, Wix, Adobe Commerce (Magento), Squarespace, Square Online, PrestaShop, Salesforce Commerce Cloud, Shopware, Ecwid and Webflow. When it recognises one, it names it at the top of the report and runs the checks that read that platform's own interfaces or settings (for example A2.8 WordPress search engine visibility or B1.8 Shopify `products.json`). Those checks run only on their platform, and a report never mentions another platform's checks ([decision 0019](docs/decisions/0019-platform-specific-checks.md)).

### Legal signals

24 more checks in 6 sections (C1 to C6) look for public legal disclosures: seller identity, privacy notices, withdrawal and returns, accessibility, product and price information, and AI transparency. Each one names the laws it relates to (63 laws across the EU, the UK, Switzerland, the United States, Canada, Australia, Brazil, Argentina, Chile, Colombia and Peru) and runs only for the markets the store appears to sell to. Legal signals are never scored and never affect the level. The hosted scanner shows them on a separate `/legal` page next to each report, which search engines do not index. They are a technical evaluation, not legal advice ([decision 0015](docs/decisions/0015-legal-signals.md)).

### What it does not check

The scanner reads public pages with ordinary HTTP requests. It does not run JavaScript, sign in, accept cookies or place orders. It reads robots.txt, sitemaps, the home page, a listing page, a sample of product pages (2 by default) and the policy pages it finds, not the whole site. So it cannot see content that only appears in the browser, prices behind a login or region-specific variants. A high score means the public surface is in order. It never means a checkout works or that a channel approved your products.

## Read a report

A report answers four questions, in this order.

1. **Which platform is this?** The top line names the recognised platform and the platform checks that ran.
2. **Which level does the store hold?** Levels go from 0 to 5. A level is gated, not averaged: the store holds it only when every gate check of that level and of all lower levels passes. The report lists the checks between the store and the next level.

   | Level | Name                  | What an agent can do                                                                                                                   |
   | ----- | --------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
   | 0     | Not reachable         | Nothing yet. Honest requests are blocked or challenged, robots.txt keeps the crawlers behind AI answers out, or pages need JavaScript. |
   | 1     | Reachable             | Read robots.txt, and read product pages without a challenge. Product content is in the HTML.                                           |
   | 2     | Readable catalog      | List the catalog. Product pages may appear in AI answers and carry Product data with a full offer.                                     |
   | 3     | Trusted merchant      | Find the return, shipping, privacy and terms pages and a way to contact the merchant.                                                  |
   | 4     | Identifiable products | Identify each product by a valid GTIN, or by brand and maker's part number (MPN).                                                      |
   | 5     | Checkout-ready        | Find a checkout it can use: a UCP profile, an ACP document or an active Shopify agentic storefront.                                    |

   Reports name Level 0 by its cause: **Not reachable** (blocked, challenged or a robots.txt error), **Closed to AI crawlers** (robots.txt keeps the crawlers behind AI answers away from product pages), **Not readable** (pages are empty without JavaScript) or **No product page found** (no product page could be read). The JSON keeps the catalog name in `level.name`.

   Level 5 means the public prerequisites are in place. It does not mean a purchase was tested. ACP (Agentic Commerce Protocol) is another open specification for agent checkout. A content site (a site that sells nothing) is scanned with the `content-site` profile, which runs only the ingestion checks and stops at Level 1. Stores use `woocommerce-store` or `other-store`. The scanner picks the profile, and `--profile` overrides it.

3. **What are the scores?** Each dimension gets a score from 0 to 100: the weight of the passed checks divided by the weight of the checks that applied. A warn counts half, and a check the scanner could not answer is left out instead of failed. Two caps keep a high score honest:
   - `not-crawlable`: while agents cannot reach and read the site (a Level 1 check failed), ingestion is at most 40 and commerce at most 30.
   - `no-checkout`: while no checkout an agent can use is advertised (none of B5.2, B5.3, B5.8), commerce is at most 60.

   A cap needs evidence: a gate check that failed or warned. The report shows the cap, the score without it and the checks that lift it. Details: [docs/scoring.md](docs/scoring.md).

4. **What do I fix first?** Open findings are grouped as **Fix first** (the next level's gates and blocking checks, weight 3), **Fix next** (expected, weight 2) and **Nice to have** (weight 1). Each finding has a fix in up to three parts: a one-line summary, an optional snippet to paste, and a brief for a coding agent you can hand to a tool such as Claude Code or Cursor. When the scanner recognised the platform, the brief adds advice for that platform.

The [knowledge base](https://agentic-readiness-scanner.space.fast/knowledge-base) explains each check in its own article: what it looks at, why agents care, how the scanner decides, how to fix it and how to verify the fix.

## Use it

### Hosted scanner

Open <https://agentic-readiness-scanner.space.fast/>, which runs on [Spacefast](https://spacefast.com/), and submit a URL. The page shows the scan as it runs and then opens the report. An agent or a script can use the API:

```bash
curl -X POST https://agentic-readiness-scanner.space.fast/api/scan -H 'content-type: application/json' -d '{"url":"https://example.com"}'
```

The answer holds the result object and links to the report. A scan runs in steps of up to 20 seconds. When it needs more than one, the API answers `202` with a `status_url` (`GET /api/scan/jobs/<id>`) and a `continue_url` (`POST /api/scan/jobs/<id>/continue`) to follow it. A hosted scan sends at most 60 requests to the store.

What the hosted scanner keeps:

- **Root URLs** (such as `https://example.com/`) get a public profile at `/sites/<host>` with the latest report, plus `/sites/<host>/report.json` and `/sites/<host>/report.md`. Each scan also keeps a fixed snapshot at `/r/<id>` (`.json` and `.md`) for 30 days.
- **History and badge:** `/h/<host>` (or `/h/<host>.json`) shows the states the host was in and what changed. `/badge/<host>.svg` renders a badge. History stays after the detailed report expires.
- **A URL with a path, query or non-default port** runs once. You get the report, and nothing about that scan is saved.
- **One new scan per host per minute**, across all paths and interfaces. A recent result for a root URL is shown again instead of fetching. `www.example.com` and `example.com` count as one host ([decision 0014](docs/decisions/0014-root-profiles-and-disposable-scans.md)).
- **Monitoring:** when the deployment has a mail provider configured, you can leave an email address on a root report. After you confirm it, the scanner rescans the host weekly and writes only when the level, a score or a check result changed. You can unsubscribe with one click ([decision 0006](docs/decisions/0006-monitoring-by-weekly-rescan.md)).

The hosted scanner also serves the knowledge base as Markdown (append `.md` to any page, or send `Accept: text/markdown`), every article in one file at `/llms-full.txt`, and an MCP server at `/mcp` (see below).

### Command line (CLI)

Two packages are on npm ([decision 0013](docs/decisions/0013-two-published-packages.md)): `@agentic-readiness/cli`, the command line with the local MCP server inside, and `@agentic-readiness/core`, the engine as a library. Both need Node 24 or later and are published with provenance by the release workflow.

```bash
npx @agentic-readiness/cli scan https://example.com
```

```bash
npx @agentic-readiness/cli scan https://example.com --format json --output report.json
```

Options for `scan`:

| Option             | Meaning                                                                | Default  |
| ------------------ | ---------------------------------------------------------------------- | -------- |
| `--format <fmt>`   | `md`, `json`, `html` or `badge`                                        | `md`     |
| `--profile <id>`   | `woocommerce-store`, `other-store` or `content-site`                   | detected |
| `--budget <n>`     | Maximum requests per scan                                              | 40       |
| `--sample <n>`     | Product pages to sample                                                | 2        |
| `--timeout <ms>`   | Timeout per request in milliseconds                                    | 10000    |
| `--markets <list>` | Markets for legal signals, for example `eu,uk,us`                      | detected |
| `--fixture <dir>`  | Answer from a recorded store instead of the network (for offline runs) | none     |
| `--output <file>`  | Write the report to a file instead of printing it                      | stdout   |

Legal signals are added to the Markdown and HTML reports and included in JSON. Other commands: `diff <a> <b>` compares two saved JSON reports and exits with code 3 when something changed, which is useful in a pipeline. `catalog` prints the check catalog, `version` the scanner version and `help` the full usage.

### MCP server

MCP (Model Context Protocol) lets AI assistants call tools. To use the scanner from a local coding agent such as Claude Code, Cursor or Claude Desktop, add an MCP server whose command is:

```bash
npx -y @agentic-readiness/cli mcp
```

It talks over stdio and offers three tools: `scan_store(url, profile?, format?)` (format `json` or `markdown`), `get_fix(check_id, platform?)` and `list_checks()`. The hosted scanner offers the same tools over Streamable HTTP at `/mcp`, plus `get_history(host)` and `explain_check(check_id)`, which returns the knowledge-base article. Its server card is at `/mcp/server-card` and is listed in `/.well-known/ai-catalog.json`.

### Library

```ts
import { scan, renderMarkdown } from '@agentic-readiness/core';

const result = await scan('https://example.com');
console.log(result.level, result.scores);
console.log(renderMarkdown(result));
```

Some hosts must answer each call within a fixed time. For them a scan can run in steps that pass a small JSON state from one call to the next ([decision 0016](docs/decisions/0016-resumable-scans.md)):

```ts
import { startScan, continueScan } from '@agentic-readiness/core';

let step = await startScan('https://example.com', { stepDeadlineMs: 15_000 });
// store step.state (a few KiB), then in a later invocation:
while (!step.done) step = await continueScan(step.state, { stepDeadlineMs: 15_000 });
console.log(step.result.steps, step.result.level);
```

A check cut off at the end of a step runs again in the next one. The request budget counts across all steps. `maxSteps`, `maxActiveMs` and a guard against steps that make no progress end the scan, and the checks left over are reported as skipped. Pass a `cache` (get and set by key) so later steps do not fetch the same pages again.

The engine uses only web-standard APIs (`fetch`, `Request`, `Response`), so it runs in Node, in workers and in tests. The published package contains the catalog and the visual system, so it needs nothing else from this repository. `@agentic-readiness/core/testing` adds the fixture fetcher for offline runs.

## How it works

One engine, three hosts: the hosted scanner, the CLI and the MCP server all call the same scan. No check knows where it runs.

```text
packages/catalog   the catalog as data: checks, levels, profiles, fixes, result schema (private, bundled into core and cli)
packages/core      fetcher, target resolver, parsers, checks, runner, scoring, reporters (published: @agentic-readiness/core)
packages/ui        visual system: Tailwind tokens, compiled stylesheet, class recipes, icons (private, bundled)
packages/mcp       MCP server definition (tools), shared by CLI and hosted app (private, bundled into cli)
packages/cli       agentic-readiness scan | diff | mcp | catalog (published: @agentic-readiness/cli, self-contained)
apps/web           Hono app: form, reports, badge, API, MCP endpoint, monitoring, knowledge base; runs on Spacefast Functions
fixtures/stores    recorded stores for deterministic tests
docs/              architecture, scoring, checks (generated), hosting, security model, release process, decisions
```

Design rules every change must respect:

- **Public signals only, fetched honestly.** Nothing needs credentials. Every request names the scanner as `AgenticReadinessScanner/<version>`, obeys robots.txt for that name and never impersonates another agent ([decision 0010](docs/decisions/0010-honest-fetch.md)).
- **The catalog is data.** A check's title, weight, dependencies, spec URLs and fix live in `packages/catalog`, not in code. A check without a public spec URL does not ship.
- **One check, one question, one fix.** A check returns a verdict and evidence. The runner skips checks whose dependency failed. A check that is not implemented says so.
- **Deterministic.** Product pages are sampled with a seed taken from the hostname, and checks run in a fixed order. The result records the catalog and scoring versions, so two reports can be compared.
- **Agent-first output.** JSON and Markdown come before HTML, and the scanner is itself an MCP tool.

More in [docs/architecture.md](docs/architecture.md). The result object follows the schema `agentic-readiness-scanner/1` in `packages/catalog/src/result.ts`.

## Develop

Requirements: Node 24 (see `.nvmrc`) and pnpm 10.

```bash
pnpm install
```

```bash
pnpm check
```

`pnpm check` runs what CI runs: repository hygiene, formatting, Markdown lint, build, lint, type-check, tests, the browser layout tests, catalog validation and generated-docs parity. Run `pnpm hooks:install` once so it runs before every push.

Other commands:

- `pnpm dev` starts the hosted scanner on <http://localhost:8787> with in-memory storage.
- `pnpm scan https://example.com` runs the CLI from the workspace (after `pnpm build`).
- `pnpm docs:generate` regenerates `docs/checks.md` from the catalog.

To add a check, read [CONTRIBUTING.md](CONTRIBUTING.md). To understand the hosting limits that shaped the stack, read [docs/hosting.md](docs/hosting.md) and the [decisions](docs/decisions).

## Roadmap

Shipped so far (details in the [changelog](CHANGELOG.md)):

- **0.1 to 0.3:** the catalog, engine, CLI, MCP server and hosted scanner with badge and monitoring, then fixes with briefs for coding agents, an audited catalog that judges crawlers by purpose, honest fetching, history per host and `diff`.
- **0.4 to 0.9:** the technical SEO audit, reports that lead with what to fix, the two npm packages and a live scan console.
- **0.10 to 0.13:** the knowledge base, legal signals, score coverage, scans in steps, score caps, and 13 recognised platforms with their own checks.
- **0.14 to 0.16:** checks for what agents do once they reach a store, levels that follow what agent checkout programmes require, plain-language reports, Level 0 named by its cause, stores rendered with JavaScript checked as stores, and knowledge-base guides on crawler blocks, crawl services and large catalogs.

Planned for 1.0: a recorded reference store per platform with a nightly comparison, Web Bot Auth signatures (a way for a site to verify who sent a request) on the scanner's own requests, and the result contract declared stable.

## Related work

[Cloudflare's Is It Agent Ready](https://isitagentready.com/) covers the agent-protocol layer for any site. [Shopify's product-page audit](https://www.shopify.com/agentic-readiness) and the [Shopware and Agentic Commerce Alliance scanner](https://scanner.agentic-commerce.org/) cover storefronts. Lumar, Semrush, Ahrefs and a dozen open-source tools cover parts of both. The [check audit](docs/audits/2026-10-31-check-audit.md) compares them check by check. This project combines both layers, reads the store the way a shopping agent does (platform interfaces, structured data, feeds, policies), keeps a public history per host and is open source.

## Licence

GPL-3.0-or-later. See [LICENSE](LICENSE).

This is an independent open-source project. It is not an Automattic, WordPress or WooCommerce product.
