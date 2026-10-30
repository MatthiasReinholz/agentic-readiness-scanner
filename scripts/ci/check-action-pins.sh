#!/usr/bin/env bash
# Every `uses:` in a workflow must reference a full 40-character commit SHA.
# Tags and branches can move; SHAs cannot.
set -euo pipefail

cd "$(git rev-parse --show-toplevel)"

status=0
while IFS= read -r file; do
  while IFS= read -r line; do
    ref="$(printf '%s' "$line" | sed -E 's/^[[:space:]-]*uses:[[:space:]]*//; s/[[:space:]]*#.*$//; s/["'"'"']//g')"
    case "$ref" in
      ./*|docker://*)
        continue
        ;;
    esac
    if ! [[ "$ref" =~ ^[^@]+@[0-9a-f]{40}$ ]]; then
      echo "$file: action is not pinned to a full commit SHA: $ref" >&2
      status=1
    fi
  done < <(grep -E '^[[:space:]-]*uses:' "$file" || true)
done < <(find .github/workflows -type f \( -name '*.yml' -o -name '*.yaml' \) | sort)

exit "$status"
