# 0013 Two published packages: the CLI with the MCP server inside, and the engine

Date: 2026-11-02. Status: accepted.
Since then: both packages are on npm, published through trusted publishing, and the home page shows the `npx` commands.

## Context

The workspace has five packages: `catalog` (the checks as data), `core` (the engine), `ui` (the visual system), `mcp` (the tool definitions for the MCP server, the interface that lets AI agents call the scanner as a tool) and `cli`. All five were set up to publish to npm, the JavaScript package registry. That meant five public names to own, five tarballs per release, and four extra packages for anyone installing the CLI. Nothing had been published yet, so the shape was still free to change.

Outside the hosted scanner, the packages serve three needs:

- A developer wants one command, `npx @agentic-readiness/cli scan <url>`, in a terminal or a pipeline.
- A coding agent wants one MCP server to add to its configuration. That is the same package, started with `mcp`.
- A platform that embeds the checks wants the engine as a library, with the catalog it was built against.

Nobody needs the visual system, the catalog or the MCP definitions on their own.

## Decision

Two packages are published, both self-contained:

- `@agentic-readiness/cli`: the command line and the local MCP server over stdio. Every workspace package is bundled in. Only third-party runtime dependencies are installed with it.
- `@agentic-readiness/core`: the engine as a library, with the catalog and the visual system bundled in and their types inlined. `import { scan, renderMarkdown } from '@agentic-readiness/core'` needs nothing else from this repository.

`catalog`, `ui` and `mcp` are private workspace packages. They keep their own versions (the release script bumps every package together) and their own tests. They are build inputs, not products. The hosted app consumes all of them through the workspace as before.

Each published package bundles with tsup (esbuild plus a declaration bundler) in its own `tsup.config.ts`. The other packages keep plain `tsc` builds. The release workflow packs and publishes the two packages. The catalog JSON and the result schema remain release assets on GitHub, since the published catalog data is also inside `core`.

## Consequences

A consumer installs one package. The published result schema and catalog data are versioned with `core`, so a report says which catalog produced it, whatever the install path.

The `@agentic-readiness` scope on npm is a prerequisite of the first publish, which uses a short-lived token once. Later releases publish through npm trusted publishing (OpenID Connect), so no token is stored ([release process](../release-process.md)). Until the first publish, the home page does not advertise `npx`, and the README says how to run from a checkout.

The cost is a bundler in the build, and duplicated third-party dependency declarations on `cli`: the engine's runtime libraries must be listed there because the engine is inlined. The full validation and the dependency review check both on every pull request.
