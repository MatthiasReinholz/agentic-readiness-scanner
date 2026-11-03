# 0009 Results are stored in three tiers, and history records states rather than scans

Date: 2026-10-31. Status: accepted.
Amended by [0014](0014-root-profiles-and-disposable-scans.md): only scans started from a root URL write to these tables, and a new scan of a host starts at most once a minute.

## Context

The hosted app stored every scan as one row with the full result JSON, purged after `RETENTION_DAYS` (30). A `targets` row per host held the last level and scores. That answers "show me this report" and "which hosts were scanned". It does not answer "how has this store developed". After the purge the trail is gone, and before it a trend needs every row parsed. Monitoring keeps a compact baseline per subscriber ([0006](0006-monitoring-by-weekly-rescan.md)), but that is one subscriber's view, not the host's history.

Tracking over time needs a form that is cheap to write on every scan and cheap to read for one host. It must stay stable across catalog changes and must not grow with abuse (at the time, a host could be scanned every two minutes).

## Decision

Three tiers, each answering one question:

1. **`scans`**: full results with evidence, one row per scan, purged after the retention window. Serves `/r/:id` and the badge. Unchanged.
2. **`scan_history`**: one row per **distinct state** per host, never purged. A state is the comparable core of a result: the level, both dimension scores, the score per section, and the verdict (plus skip reason) of every check, under one catalog and scoring version. A rescan that reproduces the newest state extends its row (`last_at`, `scans`, `last_scan_id`). A rescan that differs in any of these, or runs under a new catalog version, opens a new row. History therefore grows with what changed on the site or in the catalog, not with how often the site was scanned. The snapshot maps are stored as small JSON columns of a few hundred bytes. One host's history is then one indexed range read, and per-check analytics across hosts can use the database's JSON functions.
3. **`targets`**: one row per host with the last state, never purged. The owner's quick index. Unchanged.

The comparable core is `ResultSnapshot` in `packages/core/src/diff.ts`, the same type monitoring uses, extended with section scores and skip reasons. `sameSnapshot` decides whether a rescan confirms or changes a state. The catalog and scoring versions are part of a state's identity. A score shift across a catalog release is a different thing from a change on the site, and the history must show which it was.

History appears on these surfaces:

- `/h/<host>`: a page with a trend chart and one row per state, with what changed.
- `/h/<host>.json`.
- A "since the previous state" block on every report.
- The MCP tool `get_history`.
- The owner export `/internal/export/history.json?host=`.
- The CLI `diff` command, which compares two saved JSON reports and exits with code 3 when something changed, for pipelines.

## Consequences

- Progress over time is a first-class, public feature with a bounded storage cost. The retention purge no longer destroys the trail.
- History is per host, like the badge, and therefore public for any host that was scanned. The full results with evidence stay reachable only by report id and only within retention.
- Check ids must stay stable across catalog versions for the trail to stay readable. A dropped check shows as "absent" in the comparison, and a renamed one as absent plus new. Renaming an id is a last resort.
- Two isolates scanning the same host in the same second could both open a row for the same state. The page would show two consecutive rows with "no change". That is harmless, and the per-host cooldown makes it rare.
