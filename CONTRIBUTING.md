# Contributing

Thank you for helping stores become readable and buyable by agents. This guide covers the branch model, the development loop, how to add a check, and what CI enforces.

## Branching model

- `main` is protected and stays releasable.
- `feature/<topic>` for normal work.
- `release/<x.y.z>` for release preparation only, created by the `prepare-release` workflow.
- `hotfix/<x.y.z>` for urgent fixes branched from `main`.

Open a pull request for every change. Nobody pushes to `main`.

## Development loop

```bash
pnpm install
```

```bash
pnpm hooks:install
```

```bash
pnpm check
```

`pnpm check` runs exactly what CI runs. The pre-push hook runs it before every push; bypass intentionally with `ARS_SKIP_PUSH_GATE=1` when you know CI will tell you the same thing.

Useful during work:

- `pnpm --filter @agentic-readiness/core test` runs one package's tests.
- `pnpm scan https://example.com --format md` runs the CLI from source.
- `pnpm scan https://ceramics.example --fixture fixtures/stores/good-woocommerce` runs offline.
- `pnpm dev` serves the hosted app locally.

## Adding a check

A check is a catalog entry plus an implementation plus fixtures.

1. **Define it** in `packages/catalog/data/checks/<group>.json`: id, title, the one question it answers, how it is tested, weight (1 nice to have, 2 expected, 3 blocking, or `info`), platform requirements, dependencies, and at least one public spec URL.
2. **Write the fix** in `packages/catalog/fixes/<id>.md`: a Summary, an optional Snippet (one fenced block), and an Agent prompt. Set `auto_fix: true` only when the fix is mechanical (a file, setting or markup change a tool or agent can apply from existing store data).
3. **Implement it** in `packages/core/src/checks/<group>/index.ts` with `defineCheck`, returning `pass`, `warn`, `fail` or `skip` with evidence, and register it in `packages/core/src/checks/registry.ts`.
4. **Record fixtures** in `fixtures/stores`: make the good store pass it and, where meaningful, another fixture fail it.
5. **Regenerate docs**: `pnpm docs:generate`.
6. **Add a changelog line** under Unreleased in `CHANGELOG.md`.

A change to any check's definition, weight or fix is a catalog change: bump `version` in `packages/catalog/data/meta.json`. A change to weights or levels also bumps `scoring_version`.

## Pull request expectations

- Small, focused, with a description of what changed and why.
- Tests for new behavior. Parsers are unit-tested against fixtures; checks are tested end to end through `scan` with a recorded store.
- No new third-party GitHub Actions without a reason; every action is pinned to a full commit SHA.
- No secrets, private hostnames, or references to unreleased partner work.

## What CI enforces

`ci.yml` runs on every pull request: hygiene (no OS junk, no unpinned actions, no broken relative links), Prettier, markdownlint, build, ESLint, type-check, tests, catalog validation and generated-docs parity. `codeql.yml` and `dependency-review.yml` run alongside. Spacefast's GitHub integration builds every push on its own and reports a "Spacefast Builds" check with a preview URL for branches and pull requests; see [docs/hosting.md](docs/hosting.md).

## Releases

See [docs/release-process.md](docs/release-process.md). In short: run `prepare-release`, review the generated pull request, merge it, and `finalize-release` tags, publishes and deploys.

## Code of conduct

By participating you agree to the [Code of Conduct](CODE_OF_CONDUCT.md).
