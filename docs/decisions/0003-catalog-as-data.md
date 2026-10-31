# 0003 The check catalog is data, not code

Date: 2026-10-30. Status: accepted.

## Context

Check definitions (title, question, method, weight, dependencies, spec URLs) and fixes (summary, snippet, agent prompt, auto-fix flag) are needed by the TypeScript engine, the docs generator, the MCP tools and the PHP plugin. Two of those are not TypeScript.

## Decision

`packages/catalog` holds the catalog as JSON under `data/` and one Markdown file per fix under `fixes/`, validated by a Zod schema that also exports JSON Schema. The build generates a typed constant for TypeScript consumers and `catalog.json` for everyone else. `docs/checks.md` is generated from it and CI fails when it is stale. Implementations in `packages/core` are keyed by catalog id and carry no definition text; a catalog entry without an implementation is reported as `not_implemented`.

## Consequences

- One source of truth across languages; a reviewable diff whenever a check changes.
- The validator enforces the project's rules mechanically: no check without a public spec URL, no check without a fix, no dangling dependency, no duplicate id.
- Catalog and scoring carry their own versions, so a spec change is a catalog release and never a silent score shift.
