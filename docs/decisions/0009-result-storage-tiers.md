# 0009 Results are stored in three tiers, and history records states rather than scans

Date: 2026-10-31. Status: accepted.

## Context

The hosted app stored every scan as one row with the full result JSON, purged after `RETENTION_DAYS` (30), plus a `targets` row per host with the last level and scores. That answers "show me this report" and "which hosts were scanned", but not "how has this store developed": after the purge the trail is gone, and before it a trend needs every row parsed. Monitoring keeps a compact baseline per subscriber, which is a per-subscriber view, not the host's history.

Tracking over time needs a form that is cheap to write on every scan, cheap to read for one host, stable across catalog changes, and that does not grow with abuse (a host can be scanned every two minutes).

## Decision

Three tiers, each answering one question:

1. **`scans`**: full results with evidence, one row per scan, purged after the retention window. Serves `/r/:id` and the badge. Unchanged.
2. **`scan_history`**: one row per **distinct state** per host, never purged. A state is the comparable core of a result: level, both dimension scores, the score per group, and the verdict (plus skip reason) of every check, under one catalog and scoring version. A rescan that reproduces the newest state extends its row (`last_at`, `scans`, `last_scan_id`); a rescan that differs in any of these, or runs under a new catalog version, opens a new row. History therefore grows with what changed on the site or in the catalog, not with how often the site was scanned. The snapshot maps are stored as small JSON columns (a few hundred bytes), so one host's history is one indexed range read and per-check analytics across hosts can use the database's JSON functions.
3. **`targets`**: one row per host with the last state, never purged. The quick index for the owner. Unchanged.

The comparable core is `ResultSnapshot` in `packages/core/src/diff.ts`, the same type monitoring uses, extended with group scores and skip reasons; `sameSnapshot` decides whether a rescan confirms or changes a state. Catalog and scoring versions are part of the state identity because a score shift across a catalog release is a different thing from a change on the site, and the history must show which it was.

Surfaces: `/h/<host>` (page with a trend chart and one row per state with what changed), `/h/<host>.json`, a "since the previous state" block on every report, the MCP tool `get_history`, the owner export `/internal/export/history.json?host=`, and the CLI `diff` command for two saved JSON reports (exit code 3 on change, for pipelines).

## Consequences

- Progress over time is a first-class, public feature with a bounded storage cost; the retention purge no longer destroys the trail.
- History is per host, like the badge, and therefore public for any host that was scanned; the full results with evidence remain reachable only by report id and only within retention.
- Check ids must stay stable across catalog versions for the trail to stay readable; a dropped check shows as "absent" in the comparison, a renamed one as absent plus new. Renaming an id is a last resort.
- Two isolates scanning the same host in the same second could both open a row for the same state; the page would show it as two consecutive rows with "no change", which is harmless and the per-host cooldown makes it rare.
