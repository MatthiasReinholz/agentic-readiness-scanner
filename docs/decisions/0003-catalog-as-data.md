# 0003 The check catalog is data, not code

Date: 2026-10-30. Status: accepted.

## Context

The scanner runs a list of checks called the catalog. Each check has a definition (title, question, method, weight, dependencies, spec URLs) and a fix (summary, snippet, agent prompt, auto-fix flag). Several consumers need them: the TypeScript engine, the docs generator, the MCP tools, and tools outside this workspace that read the published `catalog.json` in any language. If the definitions lived in code, each consumer would need its own copy, and the copies would drift.

## Decision

`packages/catalog` holds the catalog as JSON under `data/` and one Markdown file per fix under `fixes/`. A Zod schema (Zod is a TypeScript validation library) validates both and also exports JSON Schema. The build generates a typed constant for TypeScript consumers and `catalog.json` for everyone else. `docs/checks.md` is generated from the catalog, and CI fails when it is stale.

Implementations in `packages/core` are keyed by catalog id and carry no definition text. A catalog entry without an implementation is reported as `not_implemented`.

## Consequences

- There is one source of truth across languages, and a reviewable diff whenever a check changes.
- The validator enforces the project's rules mechanically: no check without a public spec URL, no check without a fix, no dangling dependency, no duplicate id.
- The catalog and the scoring carry their own versions. A spec change is therefore a catalog release, never a silent score shift.
