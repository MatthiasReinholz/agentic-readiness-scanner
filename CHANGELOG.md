# Changelog

All notable changes to this project are documented here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project uses [Semantic Versioning](https://semver.org/).

## [Unreleased]

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
