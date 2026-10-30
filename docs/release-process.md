# Release process

Releases are merge-driven and tag-backed. A branch push never publishes anything.

## Normal release

1. Merge the feature pull requests into `main`.
2. Run the `prepare-release` workflow and choose `patch`, `minor`, `major` or `custom`.
3. The workflow bumps every version surface (`package.json` files, `packages/core/src/version.ts`, `CHANGELOG.md`), regenerates docs, validates the tree, pushes `release/x.y.z` and opens a pull request. Rerunning for the same version refreshes the branch and the pull request.
4. Review the pull request: read the changelog section, check the generated docs, run a scan or two against the preview deployment commented on the pull request.
5. Merge it.
6. `finalize-release` verifies that every surface carries the version, runs the full check, packages release assets with provenance attestations, creates the `vx.y.z` tag, publishes the npm packages (when `NPM_TOKEN` is configured), creates the GitHub release, and then deploys the hosted app to Spacefast, smoke-tests it and rolls back on failure (when `SPACEFAST_TOKEN` and `SPACEFAST_SPACE` are configured).

Hotfixes follow the same flow from `hotfix/x.y.z` branches.

## Version surfaces

`scripts/release/bump-version.mjs` is the only tool that edits versions:

- `--next <type> [version]` prints the next version
- `<version>` applies it everywhere and moves the Unreleased changelog section under the new heading
- `--verify <version>` fails unless every surface agrees
- `--notes <version>` prints the changelog section, used for the pull request body and the release notes

The catalog version (`packages/catalog/data/meta.json`) is independent: it changes when checks change, not on every release.

## Repository settings required

- Branch protection on `main` requiring the `Validate`, `Analyze JavaScript/TypeScript` and `Dependency review` checks.
- `Settings → Actions → General → Workflow permissions`: allow GitHub Actions to create and approve pull requests (needed by `prepare-release`).
- A `production` environment with required reviewers, holding `SPACEFAST_TOKEN` and `NPM_TOKEN`; repository variables `SPACEFAST_SPACE` and optionally `SMOKE_TARGET`.
- Require actions to be pinned to a full-length commit SHA.
