# 0004 The hosted app targets the Spacefast Functions runtime with Hono

Date: 2026-10-30. Status: accepted.
Amended by [0017](0017-stepped-hosted-scans.md): a scan no longer has to fit in one request. Hosted scans run as stepped jobs of up to 20 seconds per step, which replaces the fallback design mentioned under Consequences.

## Context

The hosted scanner needs a runtime on Spacefast, the platform this project deploys to. Spacefast offers two dynamic runtimes:

- Zero runs TypeScript in a QuickJS sandbox, with deadlines of 5 seconds for writes and 10 seconds for reads per fetch. That cannot host a scan of up to 40 sequential requests, the request budget at the time.
- Functions is a Workers-style isolate (a sandboxed JavaScript runtime in the style of Cloudflare Workers). It has standard `Request` and `Response` objects, outbound `fetch` to any public host on a claimed Space (a site on Spacefast), a D1-shaped `env.DB` binding to the Space's MySQL database, environment variables and crons.

`sf dev`, Spacefast's local development command, does not run Functions workers. Local development therefore needs another way to run the app.

## Decision

The hosted app is a Hono application (Hono is a small web router built on web standards). Hono runs unchanged on the Functions isolate (`apps/web/src/handler.ts`) and on Node (`apps/web/src/dev.ts`), which solves local development.

Results are stored through a `ResultStore` interface with two implementations: SQL for `env.DB`, and memory for development and tests. esbuild bundles the worker and its workspace dependencies into one file that Spacefast publishes.

## Consequences

- No PHP and no framework beyond a router. The app is a few hundred lines around the engine.
- Per-IP rate limiting is impossible, because the isolate does not see the client IP. The app throttles per target host instead.
- The isolate's CPU and wall-clock limits are undocumented and must be verified on the first publish. The fallback design (create a record, continue with `waitUntil`, poll) is recorded in [hosting.md](../hosting.md).
