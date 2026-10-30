# Hosting on Spacefast

The hosted scanner runs on [Spacefast](https://spacefast.com/) as a Functions worker. This page records what the platform offers, how the app uses it, and what still has to be verified on the first real publish.

## What Spacefast runs

Verified against the Spacefast docs on 2026-10-30:

- Static output is the default. A dynamic site declares exactly one runtime per version in `sf.jsonc`: **Zero** (TypeScript in a QuickJS runner with 5 to 10 second fetch deadlines) or **Functions** (a Workers-style isolate with standard `Request`/`Response`). There is no documented way to run a custom PHP application, which is why the engine is TypeScript ([decision 0001](decisions/0001-typescript-core.md), [decision 0004](decisions/0004-spacefast-functions-runtime.md)).
- Functions get `env.DB`, a D1-shaped binding to the Space's MySQL database (no connection string), outbound `fetch` to any public host on a claimed Space, environment variables sealed per version, up to 8 crons declared in `sf.jsonc`, immutable version URLs with `sf promote` and `sf rollback`.
- The client IP is not exposed to the worker, and `sf dev` does not run workers.

## How the app uses it

- `apps/web/sf.jsonc` declares the Functions runtime with `handler.js` as entry, a daily cleanup cron, security headers, and a `Link` header on `/` that advertises `llms.txt` and the MCP server card.
- `apps/web/build.mjs` bundles `src/handler.ts` and its workspace dependencies into `dist/handler.js` with esbuild and copies `public/` next to it. `sf publish ./dist` publishes that folder.
- Results are stored through `SqlResultStore` in a `scans` table (MySQL DDL). Fix text is stripped before storage and re-attached from the catalog on read, which keeps rows small.
- Per-target cooldown replaces per-IP rate limiting: a host is scanned at most once per `TARGET_COOLDOWN_SECONDS`; within that window the stored result is served.
- Configuration comes from Space variables: `APP_BASE_URL`, `APP_NAME`, `SCAN_BUDGET`, `TARGET_COOLDOWN_SECONDS`, `RETENTION_DAYS`, `PLUGIN_URL`, `REPOSITORY_URL`. Set them with `sf env set NAME value`.

## Local development

`pnpm dev` runs the same app on Node with an in-memory store. Scans go to the real network.

## Deployment flow

Pull requests from this repository publish a preview version (`sf publish --target preview`) and comment its immutable URL. Merging a release pull request tags, publishes npm packages and the GitHub release, then publishes the live version, smoke-tests `/health`, the server card and one reference scan, and rolls back on failure. Secrets and variables: `SPACEFAST_TOKEN` (a publish-only key from `sf api-keys create --preset ci_deploy`), `SPACEFAST_SPACE`, optional `SMOKE_TARGET`.

## To verify on the first real publish

- Whether `sf.jsonc` is read from the project root (`apps/web`) or must sit inside the published `dist` folder. The docs say project root; the build copies nothing, so adjust `build.mjs` if the platform expects it in `dist`.
- CPU and wall-clock limits of the Functions isolate for a scan of up to 40 sequential requests. The docs do not state them. If a full scan does not fit one request, split it: `POST /scan` creates the record, the worker continues with `waitUntil`, the report page polls.
- Whether the D1-shaped broker accepts the MySQL DDL in `apps/web/src/store/sql.ts` as written, including the inline index.
- The outbound policy for private address ranges after DNS resolution. The worker checks hostnames and literal IPs; DNS-level protection is the platform's.
- The exact shape of `sf versions --json`, which the rollback step reads to find the previously live version.
