# 0001 The engine is TypeScript, not PHP

Date: 2026-10-30. Status: accepted.

## Context

The original plan assumed one PHP library shared by the hosted scanner, the WordPress plugin and a CLI, with the hosted scanner running as a dynamic PHP Space on Spacefast. Spacefast's documented dynamic runtimes are Zero (TypeScript in a QuickJS sandbox) and Functions (a Workers-style isolate). There is no documented path to deploy a custom PHP application.

## Decision

The engine, the CLI, the MCP server and the hosted app are TypeScript written against web-standard APIs so one codebase runs in the worker, in Node and in tests. The WordPress plugin stays PHP but does not reimplement the public checks: it consumes the catalog as data and the scan result from a scanner endpoint, and adds the inside view, the full-catalog audit and the fixes.

## Consequences

- One engine to maintain instead of two; no PHP and TypeScript drift in check logic.
- The plugin depends on a scanner endpoint for the public view (hosted or self-hosted). That mirrors how an agent sees the store, which is more faithful than scanning from inside the store's own server anyway.
- Hosting the engine anywhere that runs a worker or Node is possible without a rewrite.
