# 0004 The hosted app targets the Spacefast Functions runtime with Hono

Date: 2026-10-30. Status: accepted.

## Context

Spacefast offers two dynamic runtimes. Zero runs TypeScript in a QuickJS sandbox with 5 second deadlines for writes and 10 seconds for reads per fetch, which cannot host a scan of up to 40 sequential requests. Functions is a Workers-style isolate with standard `Request` and `Response`, outbound `fetch` to any public host on a claimed Space, a D1-shaped `env.DB` binding to the Space's MySQL, environment variables and crons. `sf dev` does not run Functions workers.

## Decision

The hosted app is a Hono application. Hono runs unchanged on the Functions isolate (`apps/web/src/handler.ts`) and on Node (`apps/web/src/dev.ts`), which solves local development. Results are stored through a `ResultStore` interface with a SQL implementation for `env.DB` and a memory implementation for development and tests. esbuild bundles the worker and its workspace dependencies into one file that Spacefast publishes.

## Consequences

- No PHP, no framework beyond a router; the app is a few hundred lines around the engine.
- Per-IP rate limiting is impossible because the isolate does not see the client IP; the app throttles per target host instead.
- CPU and wall-clock limits of the isolate are undocumented and must be verified on the first publish; the fallback design (create record, continue with `waitUntil`, poll) is recorded in [hosting.md](../hosting.md).
