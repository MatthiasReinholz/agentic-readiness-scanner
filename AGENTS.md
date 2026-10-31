# Agent Operating Contract

This file is for coding agents and automated contributors working in this repository.

## Read first

1. [README.md](README.md) for what the project is and the design rules.
2. [docs/architecture.md](docs/architecture.md) for the layers and where code goes.
3. [CONTRIBUTING.md](CONTRIBUTING.md) for the branch model, how to add a check, and what CI enforces.
4. [docs/decisions](docs/decisions) before proposing a change to the stack, the repo split or the catalog model.

## Source of truth

- Check definitions, weights, dependencies, spec URLs and fixes live in `packages/catalog/data` and `packages/catalog/fixes`. Never hard-code any of these in `packages/core`.
- `docs/checks.md` and `packages/catalog/src/generated` are generated. Edit the data, run `pnpm docs:generate`, commit the result.
- The result object schema in `packages/catalog/src/result.ts` is a published contract. Breaking changes bump the `schema` id, not just the version.
- Versions live in every `package.json`, `packages/core/src/version.ts` and `CHANGELOG.md`; `scripts/release/bump-version.mjs` keeps them aligned. Do not edit them by hand.

## Rules

- A check implementation produces a verdict and evidence only. It never parses HTML or robots.txt itself (use `packages/core/src/parsers`), never calls `fetch` directly (use the `Fetcher`), and never reads the catalog for anything but its own definition.
- Every check needs a public spec URL and a fix in all three forms. If the rationale cannot cite a public URL, the check does not ship.
- Nothing in the catalog, fixes or docs may reference unreleased partner work, internal integration status, launch timing or commercial terms.
- Use web-standard APIs only in `packages/core`, `packages/mcp` and `apps/web/src` (no `node:` imports). Node-only helpers go under `packages/core/src/testing` or the CLI.
- Keep the scanner honest: unimplemented checks are reported as `not_implemented`, never guessed; a high score never claims a checkout works.
- Any URL the scanner fetches goes through the URL policy. Do not add bypasses.

## Validation

Before opening or updating a pull request:

```bash
pnpm check
```

When touching the catalog, also run `pnpm docs:generate` and commit `docs/checks.md`. When touching workflows, keep every action pinned to a full commit SHA (`scripts/ci/check-action-pins.sh` enforces it).

## Releases

Releases are merge-driven and tag-backed. Never create tags or publish packages by hand. Run the `prepare-release` workflow, review the `release/x.y.z` pull request, merge it; `finalize-release` does the rest. See [docs/release-process.md](docs/release-process.md).
