# 0013. Two published packages: the CLI with the MCP server inside, and the engine

Date: 2026-11-02. Status: accepted.

## Context

The workspace has five packages: `catalog` (the checks as data), `core` (the engine), `ui` (the visual system), `mcp` (the tool definitions) and `cli`. All five were set up to publish to npm, which meant five public names to own, five tarballs per release, and a consumer installing the CLI pulling four more packages. Nothing had been published yet, so the shape was still free to change.

What the packages are for outside the hosted scanner is narrower than five names suggest. A developer wants one command, `npx @agentic-readiness/cli scan <url>`, in a terminal or a pipeline. A coding agent wants one MCP server to add to its configuration, which is the same package started with `mcp`. A platform that embeds the checks wants the engine as a library with the catalog it was built against. Nobody needs the visual system, the catalog or the MCP definitions on their own.

## Decision

Two packages are published, both self-contained:

- `@agentic-readiness/cli`: the command line and the local MCP server over stdio. Every workspace package is bundled in; only third-party runtime dependencies are installed with it.
- `@agentic-readiness/core`: the engine as a library, with the catalog and the visual system bundled in and their types inlined, so `import { scan, renderMarkdown } from '@agentic-readiness/core'` needs nothing else from this repository.

`catalog`, `ui` and `mcp` are private workspace packages. They keep their own versions (the release script bumps every package together) and their own tests; they are build inputs, not products. The hosted app consumes all of them through the workspace as before.

Bundling is done with tsup (esbuild plus a declaration bundler) in each published package's own `tsup.config.ts`; the other packages keep plain `tsc` builds. The release workflow packs and publishes the two packages; the catalog JSON and the result schema remain release assets on GitHub, since the published catalog data is also inside `core`.

## Consequences

A consumer installs one package. The published result schema and catalog data are versioned with `core`, so a report says which catalog it was produced with whatever the install path. The `@agentic-readiness` scope on npm and the `NPM_TOKEN` secret are still prerequisites of the first publish; until then the home page does not advertise `npx`, and the README says how to run from a checkout.

The cost is a bundler in the build and duplicated third-party dependency declarations on `cli` (the engine's runtime libraries must be listed there because the engine is inlined). Both are checked by the full validation and by the dependency review on every pull request.
