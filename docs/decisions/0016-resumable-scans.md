# 0016 Resumable scans re-resolve each step and keep bodies out of the state

Date: 2026-11-03. Status: accepted.

## Context

Some hosts must answer every invocation within a fixed time (about 20 seconds on a worker platform) and cannot run work in the background. A scan of a slow store takes longer than one invocation allows, so `scan()` with `deadlineMs` ends with the remaining checks skipped as `budget_exhausted`. Retrying from zero meets the same wall, and the skipped checks drop out of the scores. The limit is per invocation, not per scan: the same host can easily give one store three invocations.

## Decision

- **Steps.** `startScan(url, options)` runs a first step and `continueScan(state, options)` the next ones; each returns `{ done: false, state }` or `{ done: true, result }`. A step has its own allowance (`stepDeadlineMs`, optionally `stepBudget` requests). When it is used up the fetcher throws `StepDeadlineError`, which is not a budget error: the interrupted check is not recorded and runs again next step.
- **Overall limits keep today's semantics.** The request budget counts across steps. When `maxSteps`, `maxActiveMs` or the stall guard says the next step is the last, that step runs with an ordinary deadline and finishes like `scan()`, skips included.
- **Re-resolve, never serialize the target.** A resolved target holds the home page and sitemap URL lists that can run to megabytes, far beyond a database row. Each step resolves the target again (deterministic for the same responses) and takes the earlier outcomes as decided. Re-sent requests (refills) are paced but never counted twice; a request cut off mid-way by a step is rolled back and counted in full when it completes.
- **Bodies stay with the host.** The state holds versions, settings, counted request keys with their send counts, decided outcomes, politeness and failures: a few KiB (2.6 KiB for the recorded WooCommerce store between steps). A host that can keep responses passes a `ResponseCache`; without one, every step re-reads the pages it needs.
- **Stall guard.** A step that decides no check and counts no new request means the store is too slow for one check to fit in a step without a cache. After `maxStalledSteps` such steps (default 2) the next step finishes the scan instead of spending the remaining steps.
- **Versioned state.** The state names its format, scanner, catalog and scoring versions; `continueScan` refuses a mismatch with `ScanStateMismatchError`.
- **Same result.** Over the same responses a stepped scan returns the result of one `scan()` call, apart from `scanned_at`, `duration_ms` (the active time of the steps, without the gaps) and the new optional `steps` field. A test runs a recorded store in many steps and compares.
- **`scan()` is unchanged.**

## Consequences

- Hosts with a per-invocation limit can finish slow stores instead of recording them as incomplete, at the cost of storing a small state and, ideally, a response cache.
- Without a cache, re-resolution costs each step the resolver's requests (home, robots.txt, sitemaps) in time; on very slow stores that can leave too little room, which the stall guard turns into the usual skips.
- Responses can change between steps on a live store; a cache makes a stepped scan see one consistent snapshot.
