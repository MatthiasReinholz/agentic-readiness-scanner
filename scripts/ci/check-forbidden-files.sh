#!/usr/bin/env bash
# Fails when tracked files include OS or editor junk, generated output, or secrets-shaped files.
set -euo pipefail

cd "$(git rev-parse --show-toplevel)"

forbidden_patterns=(
  '(^|/)\.DS_Store$'
  '(^|/)Thumbs\.db$'
  '(^|/)Desktop\.ini$'
  '(^|/)\.idea/'
  '(^|/)\.vscode/'
  '(^|/)node_modules/'
  '(^|/)dist/'
  '(^|/)\.turbo/'
  '(^|/)\.env($|\.)'
  '\.log$'
  '(^|/)\.spacefast/state\.json$'
  '(^|/)packages/catalog/src/generated/'
)

status=0
while IFS= read -r file; do
  for pattern in "${forbidden_patterns[@]}"; do
    if [[ "$file" =~ $pattern ]]; then
      if [[ "$file" == *".env.example" ]]; then
        continue
      fi
      echo "Forbidden tracked file: $file (matches $pattern)" >&2
      status=1
    fi
  done
done < <(git ls-files)

exit "$status"
