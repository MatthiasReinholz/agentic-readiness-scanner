# 0001 The engine is TypeScript, not PHP

Date: 2026-10-30. Status: accepted.
Superseded in part by [0007](0007-no-companion-plugin.md): there is no WordPress plugin, so the statements about one no longer hold. The decision about the engine stands.

## Context

The scanner checks whether AI agents can find, read, trust and buy from a website. The original plan assumed one PHP library shared by three consumers: the hosted scanner (the web app), a WordPress plugin and a CLI. The hosted scanner would run as a dynamic PHP Space (a site hosted on Spacefast, the platform this project deploys to).

Spacefast documents two dynamic runtimes. Zero runs TypeScript in a QuickJS sandbox. Functions is a Workers-style isolate (a sandboxed JavaScript runtime in the style of Cloudflare Workers). There is no documented way to deploy a custom PHP application.

## Decision

The engine, the CLI, the MCP server (the interface that lets AI coding agents call the scanner as a tool) and the hosted app are written in TypeScript against web-standard APIs. One codebase therefore runs in the worker, in Node and in tests.

The WordPress plugin stays PHP but does not reimplement the public checks. It reads the catalog as data and the scan result from a scanner endpoint. It adds the inside view, the full-catalog audit and the fixes.

## Consequences

- There is one engine to maintain instead of two, and check logic cannot drift between PHP and TypeScript.
- The plugin depends on a scanner endpoint, hosted or self-hosted, for the public view. That mirrors how an agent sees the store, which is more faithful than scanning from inside the store's own server anyway.
- The engine can run anywhere that runs a worker or Node, without a rewrite.
