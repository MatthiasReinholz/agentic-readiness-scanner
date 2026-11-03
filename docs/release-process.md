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
7. `finalize-release` verifies that every surface carries the version, runs the full check, packages release assets with provenance attestations, creates the `vx.y.z` tag, publishes the two npm packages, `@agentic-readiness/core` and `@agentic-readiness/cli`, from the very tarballs it attested (through npm trusted publishing once that is configured, see below; `catalog`, `ui` and `mcp` are private workspace packages bundled into those two, [decision 0013](decisions/0013-two-published-packages.md)) and creates the GitHub release.

The hosted app is not deployed by the workflow. Spacefast's GitHub integration builds `main` on every merge and publishes it to the `live` channel, so the release merge goes live the same way any other merge does ([decision 0005](decisions/0005-deploy-through-git-integration.md)). Roll back with `sf rollback <version>` or from the Space's Versions page.

Check that the release actually went live: the "Spacefast Builds" check on the release merge commit must be green, and the home page's structured data must carry the new version (`"softwareVersion"` in its JSON-LD). A main build can fail with `runtime_readiness_timeout` (the new runtime did not report ready in time) although the same code built on the pull request; it happened on two of four main builds on 2026-11-03. The live site then keeps serving the previous build. Redeploy from the Space's dashboard, or merge the next change to `main`; GitHub cannot re-run that check.

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
- For npm, trusted publishing rather than a stored token (see the next section). No Spacefast secrets: deployment runs through the GitHub integration.

## Publishing to npm without a token

npm's granular access tokens expire, legacy tokens are gone, and npm has scheduled the end of direct publishing with tokens for January 2027. The workflow therefore publishes through [trusted publishing](https://docs.npmjs.com/trusted-publishers/): the GitHub Actions job proves its identity to npm with a short-lived OpenID Connect token that GitHub mints per run, scoped to this repository and to `finalize-release.yml`. Nothing is stored, nothing expires, and provenance attestations are generated automatically. Two-factor authentication on the npm account is unaffected: it protects interactive publishes and the account itself, while a trusted publisher is a workflow identity npm was told to trust, so no one-time code is involved. npm recommends combining it with the package setting "Require two-factor authentication and disallow tokens", which blocks token publishes and leaves trusted publishers working.

A trusted publisher is configured in a package's settings, so each package has to exist first. The one-time sequence:

1. Create the `agentic-readiness` organisation on npmjs.com (or rename the two packages to a scope you own).
2. Create a granular access token with publish rights to the two packages and the shortest lifetime offered, and add it as the `NPM_TOKEN` repository secret. Run one release: the workflow publishes both packages with the token.
3. Delete the token on npm and the `NPM_TOKEN` secret on GitHub.
4. On npmjs.com, in the settings of `@agentic-readiness/cli` and of `@agentic-readiness/core`, add a trusted publisher: provider GitHub Actions, owner `MatthiasReinholz`, repository `agentic-readiness-scanner`, workflow file `finalize-release.yml`, no environment. Set "Require two-factor authentication and disallow tokens" on both.
5. Set the repository variable `NPM_TRUSTED_PUBLISHING` to `true` (Settings → Secrets and variables → Actions → Variables).
6. Run the next release within two days: npm validates a new trusted publisher on its first successful publish.

From then on every release publishes without anyone's involvement. When neither the variable nor the secret is set, the workflow skips npm publishing and says so, and the release still produces its tag and GitHub assets.

- Require actions to be pinned to a full-length commit SHA.
