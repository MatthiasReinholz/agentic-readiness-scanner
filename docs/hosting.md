# Hosting on Spacefast

The hosted scanner runs on [Spacefast](https://spacefast.com/) as a Functions worker, live at <https://agentic-readiness-scanner.space.fast/>. This page records what the platform offers, how the app uses it, and what was verified on the live deployment.

## What Spacefast runs

Verified against the Spacefast docs on 2026-10-30:

- Static output is the default. A dynamic site declares exactly one runtime per version in `sf.jsonc`, the Spacefast configuration file. The choice is **Zero** (TypeScript in a QuickJS runner with 5 to 10 second fetch deadlines) or **Functions** (a Workers-style isolate with standard `Request` and `Response`). There is no documented way to run a custom PHP application, which is why the engine is TypeScript ([decision 0001](decisions/0001-typescript-core.md), [decision 0004](decisions/0004-spacefast-functions-runtime.md)).
- Functions get `env.DB`, a D1-shaped binding to the Space's MySQL database (no connection string). They also get outbound `fetch` to any public host on a claimed Space, environment variables sealed per version, up to 8 crons declared in `sf.jsonc`, and immutable version URLs with `sf promote` and `sf rollback`. (A Space is one Spacefast site with its database and settings.)
- The client IP is not exposed to the worker, and `sf dev` does not run workers.

## How the app uses it

### Build and runtime files

- `apps/web/sf.jsonc` declares the Functions runtime with `handler.js` as entry, three crons and public access. The crons are result cleanup (daily), the monitoring check (daily) and the scan sweeper (hourly, `/internal/cron/scan-jobs`). The platform refuses crontab schedules such as `* * * * *` with "Crontab expressions are not supported", although its docs list them, so hourly is the finest schedule. Spacefast reads `sf.jsonc` from the root of the directory it publishes, so the build copies this file into `dist/`.
- The `headers` rules in `sf.jsonc` apply to static files only (verified on the first live deploy). So the worker sets `X-Content-Type-Options` and `Referrer-Policy` on every response itself. On `/` it also sends a `Link` header that advertises `llms.txt`, the MCP endpoint (`/mcp`) and the AI catalog (`/.well-known/ai-catalog.json`), which lists the MCP server card.
- `apps/web/build.mjs` bundles `src/handler.ts` and its workspace dependencies into `dist/handler.js` with esbuild, renders the social preview images, and copies `public/` and `sf.jsonc` next to it. It needs the workspace packages built first, so always run it through turbo (`pnpm build` at the repository root). The `dist` folder is what Spacefast publishes. `sf publish apps/web/dist` from a linked machine publishes it by hand, which is only for emergencies.
- The repository-root `sf.jsonc` holds only the `build` block for the connected GitHub repository: install with `corepack enable && pnpm install --frozen-lockfile`, build with `pnpm turbo run build --filter=@agentic-readiness/web...`, publish `apps/web/dist`. Build settings in the Spacefast dashboard override this file, so leave them on "Auto" there.

### Configuration

Configuration comes from Space variables, set with `sf env set NAME value` (secrets with `--value-from-stdin`). A value that is not a positive whole number is a configuration error, and the app does not start.

| Variable                  | Default                                                         | Meaning                                                                                                                                                                                                  |
| ------------------------- | --------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `APP_BASE_URL`            | the origin of the request                                       | Base of every link in reports and emails. Set it explicitly in production. Monitoring stays off without it.                                                                                              |
| `APP_NAME`                | `Agentic Readiness Scanner`                                     | Name shown on pages and in emails.                                                                                                                                                                       |
| `SCAN_BUDGET`             | `60`                                                            | Requests per scan, across all its steps.                                                                                                                                                                 |
| `SCAN_STEP_MS`            | `20000`                                                         | Time allowance of one step, in milliseconds. Functions answer within 30 s, and a step needs a few seconds to store what it did. The old `SCAN_DEADLINE_MS` is read as this when `SCAN_STEP_MS` is unset. |
| `SCAN_MAX_STEPS`          | `12`                                                            | Steps after which a scan finishes and marks the checks it did not reach.                                                                                                                                 |
| `SCAN_MAX_ACTIVE_MS`      | `180000`                                                        | Active scanning time across steps after which a scan finishes the same way.                                                                                                                              |
| `TARGET_COOLDOWN_SECONDS` | `60` (also the minimum)                                         | Seconds between two new scans of one host.                                                                                                                                                               |
| `RETENTION_DAYS`          | `30`                                                            | Days a full scan result is kept.                                                                                                                                                                         |
| `REPOSITORY_URL`          | `https://github.com/MatthiasReinholz/agentic-readiness-scanner` | Link to the source, in pages and the server card.                                                                                                                                                        |
| `MAIL_PROVIDER`           | unset (monitoring off)                                          | `brevo` (the production choice) or `resend`, both need `MAIL_API_KEY`. `console` prints mail to the runtime log and is what `pnpm dev` uses.                                                             |
| `MAIL_API_KEY`            | unset                                                           | Secret. For Brevo, an API key from SMTP & API, then API keys.                                                                                                                                            |
| `MAIL_FROM`               | `<APP_NAME> <monitor@<host of APP_BASE_URL>>`                   | Sender on a domain or address verified with the provider, for example `Agentic Readiness Scanner <monitor@example.com>`.                                                                                 |
| `MONITOR_INTERVAL_DAYS`   | `7`                                                             | Days between rescans of a monitored host ([decision 0006](decisions/0006-monitoring-by-weekly-rescan.md)).                                                                                               |
| `MONITOR_BATCH_SIZE`      | `10`                                                            | Subscriptions processed per daily cron run.                                                                                                                                                              |
| `ADMIN_TOKEN`             | unset (exports off)                                             | Secret. Enables the export endpoints below.                                                                                                                                                              |

### Admission and scope

- Host admission uses an atomic SQL reservation (table `scan_limits`) shared by HTTP, the hosted MCP server and monitoring. At most one new scan starts per host per `TARGET_COOLDOWN_SECONDS`, whatever path on the host was submitted. Within that window a root URL gets the stored root result again when there is one. Any other submission gets 429 with a retry time. A failed scan uses up the reservation too.
- Only root URLs (`https://example.com/`) write durable data: a result, a profile at `/sites/<host>`, history and progress. A scan of a path or with a query string is one-time: it writes no result, profile, history or progress. If it needs several steps, its job row (state, cached responses, then the result) stays only until the result is delivered. The sweeper removes any such row once it is an hour old, at its next hourly run. See [the scope decision](decisions/0014-root-profiles-and-disposable-scans.md).

### Stepped scans

Scans run as jobs in steps ([decision 0017](decisions/0017-stepped-hosted-scans.md)). A `scan_jobs` row keeps the resumable state between steps, and `scan_job_cache` keeps the responses a step fetched (gzipped). Each step runs inside one request. The next step is run by whichever comes first:

1. the page calling `POST /api/scan/jobs/<id>/continue`
2. the worker calling that endpoint itself after a step (through `waitUntil`)
3. the sweeper cron
4. the next request for the same root

A lease on the row keeps two steps from running at once. An isolate runs at most 4 steps at once and answers 503 beyond that.

### Storage and cleanup

| Table            | Holds                                                                                       | Removed                                                          |
| ---------------- | ------------------------------------------------------------------------------------------- | ---------------------------------------------------------------- |
| `scans`          | full results of root scans                                                                  | after `RETENTION_DAYS`                                           |
| `targets`        | one row per host: first and last seen, scan count, last level, scores, platform and profile | never                                                            |
| `scan_history`   | one row per distinct state of a host                                                        | never                                                            |
| `scan_progress`  | the events of a scan in flight, for the page's poll                                         | an hour after the last update                                    |
| `scan_jobs`      | stepped scans                                                                               | running jobs fail after 30 minutes, finished ones go after a day |
| `scan_job_cache` | responses fetched by a step                                                                 | when the job ends, or after 2 hours                              |
| `scan_limits`    | the host reservations                                                                       | after a day                                                      |
| `monitors`       | monitoring subscriptions (tokens stored as SHA-256 only)                                    | unconfirmed ones after 48 hours                                  |

The daily cleanup cron does these removals. The hourly sweeper also removes the job rows of one-time scans once they are an hour old. Results are stored through `SqlResultStore`. Fix text is stripped before storage and re-attached from the catalog on read, which keeps rows small.

Every root scan also upserts its host's row in `targets` and records the host's state in `scan_history`. A state is the level, the scores, the score per section, the verdict and skip reason per check, and the catalog and scoring versions. A rescan that changes nothing extends the current row, and a change opens a new one. Neither table is purged, so the owner can always see which sites were checked, and `/h/<host>` can show how a site developed ([decision 0009](decisions/0009-result-storage-tiers.md)).

## Owner access to the data

There is no public admin UI. There are two private paths:

- **Database console.** In the Space's dashboard open **Database**, then **Open db console** (or run `sf db console`). This signs you into phpMyAdmin for the Space's MySQL. In `scan_history`, `verdicts_json` is a map of check id to verdict, so `JSON_EXTRACT(verdicts_json, '$."A2.2"')` answers per-check questions across hosts. A useful query: `SELECT host, scan_count, last_seen_at, last_level, last_ingestion, last_commerce FROM targets ORDER BY last_seen_at DESC`.
- **Export endpoints.** With `ADMIN_TOKEN` set, `GET /internal/export/targets.json`, `GET /internal/export/history.json?host=<host>` and `GET /internal/export/monitors.json` answer to `Authorization: Bearer <token>` and nothing else. They take an optional `?limit=` (default 1000, at most 5000). Token hashes are never included. Example: `curl -H "Authorization: Bearer $ADMIN_TOKEN" https://agentic-readiness-scanner.space.fast/internal/export/targets.json`.

## Local development

`pnpm dev` runs the same app on Node with in-memory stores and a console mailer. Scans go to the real network.

## Deployment flow

The repository is connected to the Space through Spacefast's GitHub integration (`sf git connect`, or Builds, then Connect GitHub in the dashboard). Spacefast builds every push. The production branch publishes to the `live` channel. Every other branch or pull request gets a preview build with its own alias, and previews need a Spacefast sign-in to open. Both are on by default and can be switched off per connection. The build runs the commands from the root `sf.jsonc` and reports a "Spacefast Builds" check on the commit.

GitHub Actions does not publish to Spacefast and holds no Spacefast secrets ([decision 0005](decisions/0005-deploy-through-git-integration.md)). CI validates, and Spacefast builds and serves. Because every merge into `main` goes live, `main` must stay protected behind the CI checks. A bad deploy is undone with `sf rollback <version>` or from the Space's Versions page, independent of Git.

After a deploy, check `/health` (it returns the scanner and catalog versions) and `/.well-known/mcp/server-card.json` on the live address, and run one scan. See [release-process.md](release-process.md) for what to do when a build does not go live.

## Verified on the live deployment (2026-10-31)

- On that date, before hosted scans ran in steps, a full scan (13 to 17 requests against real stores, with the budget of 40 requests used then) completed inside one request in about four seconds, and no CPU or wall-clock limit was hit. The platform does not publish the isolate limits. Since [decision 0017](decisions/0017-stepped-hosted-scans.md), hosted scans run as stepped jobs (budget 60, steps of up to 20 s, at most 12 steps and 180 s of active time), so a slow store no longer has to fit into one request.
- The D1-shaped broker accepted the MySQL DDL in `apps/web/src/store/sql.ts`, `targets/sql.ts` and `monitoring/sql.ts` as written, including inline indexes, a unique key and `INSERT … ON DUPLICATE KEY UPDATE`.
- `sf.jsonc` is read from the root of the published directory, and its `headers` rules do not apply to worker responses.
- Builds from the connected repository need the root `sf.jsonc` build block. Auto-detection ran `pnpm build` in the wrong place.
- The platform blocks public hostnames that resolve to private addresses (DNS rebinding, `*.nip.io`-style names). The worker checks hostnames and literal IPs, and the platform covers the DNS level. On version 19, scanning `http://127.0.0.1.nip.io/` and `http://10.0.0.1.nip.io/` both failed with "HTTP 530" from the platform, so Spacefast's egress refuses connections to private addresses after DNS resolution.
