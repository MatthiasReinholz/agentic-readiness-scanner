#!/usr/bin/env bash
# docs/checks.md is generated from the catalog. The check regenerates it and fails when
# the result differs from the file that was there, i.e. when the committed file is stale.
set -euo pipefail

cd "$(git rev-parse --show-toplevel)"

before="$(mktemp)"
trap 'rm -f "$before"' EXIT
cp docs/checks.md "$before"

pnpm --filter @agentic-readiness/catalog docs >/dev/null

if ! cmp -s "$before" docs/checks.md; then
  echo "docs/checks.md is out of date. Run 'pnpm docs:generate' and commit the result." >&2
  diff -u "$before" docs/checks.md | head -40 >&2 || true
  exit 1
fi

echo "docs/checks.md is up to date."
