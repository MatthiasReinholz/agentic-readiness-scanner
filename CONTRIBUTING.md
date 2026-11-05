# Contributing

Thank you for helping stores become readable and buyable by AI agents. This guide covers the branch model, the development loop, how to add a check, and what CI enforces. Start with the [README](README.md) for what the project does and [docs/architecture.md](docs/architecture.md) for where code goes.

## Branching model

- `main` is protected and stays releasable.
- `feature/<topic>`, `fix/<topic>` or `docs/<topic>` for normal work.
- `release/<x.y.z>` for release preparation only, created by the `prepare-release` workflow.
- `hotfix/<x.y.z>` for urgent fixes branched from `main`.

Open a pull request for every change. Nobody pushes to `main`.

## Development loop

You need Node 24 (see `.nvmrc`) and pnpm 10.

```bash
pnpm install
```

```bash
pnpm hooks:install
```

```bash
pnpm check
```

`pnpm check` runs exactly what CI runs. The pre-push hook that `pnpm hooks:install` sets up runs it before every push. To skip it on purpose, for example when CI will tell you the same thing, set `ARS_SKIP_PUSH_GATE=1`.

Useful during work:

- `pnpm --filter @agentic-readiness/core test` runs one package's tests.
- `pnpm scan https://example.com --format md` runs the CLI from source (after `pnpm build`).
- `pnpm scan https://ceramics.example --fixture fixtures/stores/good-woocommerce` runs offline against a recorded store.
- `pnpm dev` serves the hosted scanner locally on <http://localhost:8787>.
- UI work: the report markup lives in `packages/core/src/reporters`, the hosted pages in `apps/web/src/pages`. Both use the class recipes of `packages/ui`, and `pnpm build` recompiles the stylesheet from them. Write class names as complete literals (see [packages/ui/README.md](packages/ui/README.md)).
- `pnpm test:layout` runs the browser regression suite in `apps/web/e2e` (Playwright with Chromium). Install the browser once with `pnpm --filter @agentic-readiness/web exec playwright install chromium`. The suite serves the app from the recorded stores and checks every page family from 320 to 1440px wide, in both themes and at 200% text size. It looks for page-level horizontal scroll, wrapped or clipped catalog IDs, controls under 44px and the shared page shell. It also covers the handoff from scan to report, reduced motion, the knowledge-base filter, the theme toggle and the homepage without JavaScript. When you change a layout on purpose, adjust the rule in `apps/web/e2e/layout.ts` in the same pull request and say why.

## Adding a check

A check is a catalog entry, a fix, a knowledge-base article, an implementation and fixtures.

1. **Define it** in `packages/catalog/data/checks/<section>.json` (for example `A2.json`): id, title, the one question it answers, how it is tested, weight (1 nice to have, 2 expected, 3 blocking, or `info` for reported but never scored), platform requirements, dependencies and at least one public spec URL. Before you add a check on an AI convention, read the [check audit](docs/audits/2026-10-31-check-audit.md). It records which conventions have a documented consumer, and the catalog scores only those. Crawler tokens live in `packages/core/src/checks/crawlers.ts`, grouped by what their operator documents them for. A training crawler never costs points.
2. **Write the fix** in `packages/catalog/fixes/<id>.md` with a `## Summary`, an optional `## Snippet` (one fenced block) and an `## Agent prompt` (the brief for a coding agent). Keep all three platform-neutral.
   - Advice that holds on one platform only goes in an optional `## On <platform>` section, named by the platform's label or id (`## On WordPress`, `## On Shopify`, `## On Magento`). The ids are in `packages/catalog/src/platform-ids.ts`. A report adds the section to the agent prompt only when the scan recognised that platform (a WordPress section also applies to WooCommerce). The knowledge base lists every section.
   - Set `auto_fix: true` in the front matter only when the fix is mechanical: a file, setting or markup change that a tool or agent can apply from existing store data.
3. **Declare platform checks.** A check that reads an interface only one platform has, or the public trace of one of its settings, names that platform in `requires` (`["magento"]`, `["wordpress"]`). It never runs elsewhere, and reports never mention it there ([decision 0019](docs/decisions/0019-platform-specific-checks.md)). To recognise a new platform, add a fingerprint in `packages/core/src/target/platforms.ts` and a label in `packages/catalog/src/platforms.ts`.
4. **Write the article** in `packages/catalog/knowledge/<id>.md`. Every check needs one, and the catalog build fails without it. The format and writing rules are in [docs/knowledge-base.md](docs/knowledge-base.md).
5. **Implement it** in `packages/core/src/checks/<section>/index.ts` (lowercase, for example `a2`), or in `packages/core/src/checks/platforms` for a platform check, with `defineCheck`, returning `pass`, `warn`, `fail` or `skip` with evidence, and register it in `packages/core/src/checks/registry.ts`. Every request goes out under the scanner's own user agent. A check never sends another agent's token ([decision 0010](docs/decisions/0010-honest-fetch.md)). A check that reads an optional file skips as `not_applicable` when the file is absent, unless the catalog says absence is a finding.
6. **Test every branch** in the `index.test.ts` next to the implementation with the harness from `@agentic-readiness/core/testing`:
   - `mapFetcher({ url: body })` answers from an in-memory map.
   - `targetFor({ products, robots, policies })` builds the target.
   - `runCheck(check, target, fetcher)` runs one check with its catalog definition.

   Write one `it` per verdict and skip reason, and assert the verdict, the `skipReason` and the evidence fields a fix relies on.

7. **Record fixtures** in `fixtures/stores`: the good store should pass the check and, where it makes sense, another fixture should fail it.
8. **Regenerate the docs** with `pnpm docs:generate` and validate with `pnpm --filter @agentic-readiness/catalog validate`.
9. **Add a changelog line** under Unreleased in `CHANGELOG.md`.

Legal-signal checks follow the same steps with three differences. The definition goes in `packages/catalog/data/legal/checks/<section>.json` with weight `info`, the markets it is limited to (none means every store) and the ids of the laws it relates to, which must exist in `packages/catalog/data/legal/laws.json`. The implementation goes in `packages/core/src/checks/legal`, built with `defineLegalCheck` and listed in that folder's `index.ts`. The article follows the legal-signals rules in [docs/knowledge-base.md](docs/knowledge-base.md) ([decision 0015](docs/decisions/0015-legal-signals.md)).

A change to a check's definition, weight or fix is a catalog change: bump `version` in `packages/catalog/data/meta.json`. A change to weights, levels or the scoring formulas also bumps `scoring_version` ([docs/scoring.md](docs/scoring.md)).

## Pull request expectations

- Small and focused, with a description of what changed and why.
- Tests for new behaviour. Parsers are unit-tested against fixtures. Checks are unit-tested per branch with `mapFetcher` and end to end through `scan` with a recorded store.
- No new third-party GitHub Actions without a reason. Every action is pinned to a full commit SHA.
- No secrets, no private hostnames and no references to unreleased partner work.

## What CI enforces

`ci.yml` runs on every pull request:

- repository hygiene: no OS junk files, no unpinned actions, no broken relative links
- Prettier and markdownlint
- build, ESLint, type-check and tests
- the layout regression suite
- catalog validation and generated-docs parity

`codeql.yml` and `dependency-review.yml` run alongside. Spacefast's GitHub integration also builds every push and reports a "Spacefast Builds" check with a preview URL for branches and pull requests (see [docs/hosting.md](docs/hosting.md)).

## Releases

See [docs/release-process.md](docs/release-process.md). In short: run the `prepare-release` workflow, review the `release/x.y.z` pull request, push one commit from your own account so its checks start, and merge it. `finalize-release` then tags the release, creates the GitHub release and publishes the npm packages. Spacefast deploys the merge to `main` like any other.

## Code of conduct

By taking part you agree to the [Code of Conduct](CODE_OF_CONDUCT.md).
