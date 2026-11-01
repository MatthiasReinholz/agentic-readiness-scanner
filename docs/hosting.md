# Hosting on Spacefast

The hosted scanner runs on [Spacefast](https://spacefast.com/) as a Functions worker. This page records what the platform offers, how the app uses it, and what still has to be verified on the first real publish.

## What Spacefast runs

Verified against the Spacefast docs on 2026-10-30:

- Static output is the default. A dynamic site declares exactly one runtime per version in `sf.jsonc`: **Zero** (TypeScript in a QuickJS runner with 5 to 10 second fetch deadlines) or **Functions** (a Workers-style isolate with standard `Request`/`Response`). There is no documented way to run a custom PHP application, which is why the engine is TypeScript ([decision 0001](decisions/0001-typescript-core.md), [decision 0004](decisions/0004-spacefast-functions-runtime.md)).
- Functions get `env.DB`, a D1-shaped binding to the Space's MySQL database (no connection string), outbound `fetch` to any public host on a claimed Space, environment variables sealed per version, up to 8 crons declared in `sf.jsonc`, immutable version URLs with `sf promote` and `sf rollback`.
- The client IP is not exposed to the worker, and `sf dev` does not run workers.

## How the app uses it

- `apps/web/sf.jsonc` declares the Functions runtime with `handler.js` as entry, two daily crons (result cleanup and the monitoring check) and public access. Spacefast reads `sf.jsonc` from the root of the directory it publishes, so the build copies this file into `dist/`. Its `headers` rules apply to static files only (verified on the first live deploy), so the worker sets `X-Content-Type-Options` and `Referrer-Policy` on every response and a `Link` header on `/` that advertises `llms.txt` and the MCP server card.
- `apps/web/build.mjs` bundles `src/handler.ts` and its workspace dependencies into `dist/handler.js` with esbuild and copies `public/` and `sf.jsonc` next to it. It needs the workspace packages built first, so always run it through turbo (`pnpm build` at the repository root). The folder is what Spacefast publishes; `sf publish apps/web/dist` from a linked machine publishes it by hand, which is only for emergencies.
- The repository-root `sf.jsonc` holds only the `build` block for the connected GitHub repository: install with `corepack enable && pnpm install --frozen-lockfile`, build with `pnpm turbo run build --filter=@agentic-readiness/web...`, publish `apps/web/dist`. Build settings in the Spacefast dashboard override this file, so leave them on "Auto" there.
- Results are stored through `SqlResultStore` in a `scans` table (MySQL DDL). Fix text is stripped before storage and re-attached from the catalog on read, which keeps rows small.
- Per-target cooldown replaces per-IP rate limiting: a host is scanned at most once per `TARGET_COOLDOWN_SECONDS`; within that window the stored result is served.
- Configuration comes from Space variables, set with `sf env set NAME value` (secrets with `--value-from-stdin`):
  - Scanning: `APP_BASE_URL` (set it explicitly in production; it is the base of every link in reports and emails), `APP_NAME`, `SCAN_BUDGET`, `SCAN_DEADLINE_MS` (wall-clock budget per scan, default 24000; Functions answer within 30 s, so a slow store gets a report with the remaining checks marked not run instead of a platform error), `TARGET_COOLDOWN_SECONDS`, `RETENTION_DAYS`, `REPOSITORY_URL`.
  - Monitoring ([decision 0006](decisions/0006-monitoring-by-weekly-rescan.md)): `MAIL_PROVIDER` (`brevo`, the configured provider; `resend` is also implemented; `console` prints mail to the runtime log and is what `pnpm dev` uses; unset disables monitoring entirely), `MAIL_API_KEY` (secret; for Brevo an API key from SMTP & API → API keys), `MAIL_FROM` (a sender on a domain or address verified with the provider, e.g. `Agentic Readiness Scanner <monitor@example.com>`), `MONITOR_INTERVAL_DAYS` (default 7), `MONITOR_BATCH_SIZE` (subscriptions per daily cron run, default 10).
  - Owner access: `ADMIN_TOKEN` (secret; enables the export endpoints below).
- Every scan also upserts a row in the `targets` table (host, first and last seen, scan count, last level, scores, platform, profile) and records the host's state in `scan_history`: one row per distinct state (level, scores, score per group, verdict and skip reason per check, catalog and scoring version), extended when a rescan changes nothing and opened anew when anything changed. Neither table is purged, so the owner can always see which sites were checked and `/h/<host>` can show how a site developed ([decision 0009](decisions/0009-result-storage-tiers.md)).

## Owner access to the data

Not a public admin UI; two private paths:

- **Database console.** In the Space's dashboard open **Database → Open db console** (or run `sf db console`), which signs you into phpMyAdmin for the Space's MySQL. Tables: `scans` (recent results), `scan_history` (every distinct state per host; `verdicts_json` is a map of check id to verdict, so `JSON_EXTRACT(verdicts_json, '$."A2.2"')` answers per-check questions across hosts), `targets` (every host ever scanned), `monitors` (subscriptions; tokens stored as SHA-256 only). A useful query: `SELECT host, scan_count, last_seen_at, last_level, last_ingestion, last_commerce FROM targets ORDER BY last_seen_at DESC`.
- **Export endpoints.** With `ADMIN_TOKEN` set, `GET /internal/export/targets.json`, `GET /internal/export/history.json?host=<host>` and `GET /internal/export/monitors.json` (optional `?limit=`, max 5000) answer to `Authorization: Bearer <token>` and nothing else; token hashes are never included. Example: `curl -H "Authorization: Bearer $ADMIN_TOKEN" https://agentic-readiness-scanner.space.fast/internal/export/targets.json`.

## Local development

`pnpm dev` runs the same app on Node with an in-memory store. Scans go to the real network.

## Deployment flow

The repository is connected to the Space through Spacefast's GitHub integration (`sf git connect`, or Builds → Connect GitHub in the dashboard). Spacefast builds every push: the production branch publishes to the `live` channel and every other branch or pull request gets a preview build with its own alias. Both are on by default and can be switched off per connection. The build runs the commands from the root `sf.jsonc` and reports a "Spacefast Builds" check on the commit.

GitHub Actions does not publish to Spacefast and holds no Spacefast secrets ([decision 0005](decisions/0005-deploy-through-git-integration.md)). CI validates; Spacefast builds and serves. Because every merge into `main` goes live, `main` must stay protected behind the CI checks, and a bad deploy is undone with `sf rollback <version>` or from the Space's Versions page, independent of Git.

After a deploy, check `/health` and `/.well-known/mcp/server-card.json` on the live address and run one scan.

## Verified on the live deployment (2026-10-31)

- A full scan (13 to 17 requests against real stores, budget 40) completes inside one request in about four seconds; no CPU or wall-clock limit was hit. The platform does not publish the isolate limits, so a scan that needs the whole budget against a slow host remains the case to watch. If it ever fails, split the work: `POST /scan` creates the record, the worker continues with `waitUntil`, the report page polls.
- The D1-shaped broker accepted the MySQL DDL in `apps/web/src/store/sql.ts`, `targets/sql.ts` and `monitoring/sql.ts` as written, including inline indexes, a unique key and `INSERT … ON DUPLICATE KEY UPDATE`.
- `sf.jsonc` is read from the root of the published directory, and its `headers` rules do not apply to worker responses.
- Builds from the connected repository need the root `sf.jsonc` build block; auto-detection ran `pnpm build` in the wrong place.
- The outbound policy for public hostnames that resolve to private addresses (DNS rebinding, `*.nip.io`-style names): the worker checks hostnames and literal IPs, and the platform covers the DNS level. On version 19, scanning `http://127.0.0.1.nip.io/` and `http://10.0.0.1.nip.io/` both failed with "HTTP 530" from the platform, so Spacefast's egress refuses connections to private addresses after DNS resolution.
