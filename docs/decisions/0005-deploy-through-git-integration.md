# 0005 The hosted app deploys through Spacefast's GitHub integration

Date: 2026-10-30. Status: accepted.

## Context

The scaffold shipped two deploy paths: a `preview` job in `ci.yml` that ran `sf publish --target preview` on pull requests, and a `deploy` job in `finalize-release.yml` that published the live version after a release merge, smoke-tested it and rolled back on failure. Both needed a `SPACEFAST_TOKEN` secret and a `SPACEFAST_SPACE` variable.

Spacefast's GitHub integration does the same work without them. Once a repository is connected, the platform builds every push: the production branch publishes to the `live` channel and every other branch or pull request gets a preview build with its own alias. Build settings come from the `build` block of the repository-root `sf.jsonc`. The build reports a "Spacefast Builds" check on the commit.

## Decision

Deployment runs only through the GitHub integration. GitHub Actions validates (CI), tags and publishes packages (release), and holds no Spacefast credentials. `main` is the production branch, so every merge into `main` goes live; this is acceptable because `main` is protected behind the CI checks and because Spacefast versions are immutable and can be rolled back with `sf rollback` independently of Git.

## Consequences

- No Spacefast secrets in GitHub, no second deploy path, no token to rotate.
- Releases (`vx.y.z` tags, npm, GitHub release) and deploys are decoupled: a feature merge deploys without a release, and a release merge deploys like any other merge.
- Build-time problems surface in the Spacefast dashboard and `sf builds logs`, not in Actions logs.
- If release-gated deploys are ever needed, turn production auto-deploy off on the connection and trigger `sf git build --ref vX.Y.Z --target production` from `finalize-release`; that reintroduces one token.
