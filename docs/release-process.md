# Release process

Releases are merge-driven and tag-backed. A branch push never publishes anything.

## Normal release

1. Merge the feature pull requests into `main`.
2. Run the `prepare-release` workflow and choose `patch`, `minor`, `major` or `custom`.
3. The workflow bumps every version surface (`package.json` files, `packages/core/src/version.ts`, `CHANGELOG.md`), regenerates docs, validates the tree, pushes `release/x.y.z` and opens a pull request. Rerunning for the same version refreshes the branch and the pull request.
4. Start the required checks. The workflow pushes the branch and opens the pull request with the workflow's own `GITHUB_TOKEN`, and GitHub does not start workflow runs for pushes made with that token, so the `Validate`, `Analyze JavaScript/TypeScript` and `Dependency review` checks stay at "action required" and the merge button stays blocked. Push one commit from your own account to the release branch; an empty one is enough:

   ```bash
   git fetch origin release/x.y.z && git checkout release/x.y.z
   git commit --allow-empty -m "Trigger checks for release x.y.z" && git push origin release/x.y.z
   ```

   This is deliberate: a personal access token or GitHub App token in the workflow would remove the step but would also let the workflow trigger itself, and a human push keeps a person in the loop before every release.

5. Review the pull request: read the changelog section, check the generated docs, run a scan or two against the Spacefast preview build linked from the "Spacefast Builds" check.
6. Merge it (squash). The branch is deleted on merge.
7. `finalize-release` verifies that every surface carries the version, runs the full check, packages release assets with provenance attestations, creates the `vx.y.z` tag, publishes the npm packages (when `NPM_TOKEN` is configured) and creates the GitHub release.

The hosted app is not deployed by the workflow. Spacefast's GitHub integration builds `main` on every merge and publishes it to the `live` channel, so the release merge goes live the same way any other merge does ([decision 0005](decisions/0005-deploy-through-git-integration.md)). Roll back with `sf rollback <version>` or from the Space's Versions page.

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
- The `NPM_TOKEN` repository secret (a granular token limited to the published packages) once the packages are published to npm. No Spacefast secrets: deployment runs through the GitHub integration.
- Require actions to be pinned to a full-length commit SHA.
