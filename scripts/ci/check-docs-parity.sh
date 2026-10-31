#!/usr/bin/env bash
# docs/checks.md is generated from the catalog. CI fails when it is stale.
set -euo pipefail

cd "$(git rev-parse --show-toplevel)"

pnpm --filter @agentic-readiness/catalog docs >/dev/null

if ! git diff --quiet -- docs/checks.md; then
  echo "docs/checks.md is out of date. Run 'pnpm docs:generate' and commit the result." >&2
  git --no-pager diff --stat -- docs/checks.md >&2
  exit 1
fi

echo "docs/checks.md is up to date."
