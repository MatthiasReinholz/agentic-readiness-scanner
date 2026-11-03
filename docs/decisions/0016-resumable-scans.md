# 0016 Resumable scans re-resolve each step and keep bodies out of the state

Date: 2026-11-03. Status: accepted.

## Context

Some hosts must answer every invocation within a fixed time and cannot run work in the background. Spacefast Functions, for example, answer each request within 30 seconds, which leaves about 20 seconds for scanning. A scan of a slow store takes longer than one invocation allows. The engine's `scan()` with `deadlineMs` then ends with the remaining checks skipped as `budget_exhausted`. Retrying from zero hits the same wall, and the skipped checks drop out of the scores.

The limit applies per invocation, not per scan. The same host can easily give one store three invocations, if the scan can stop and pick up where it left off.

## Decision

- **Steps.** `startScan(url, options)` runs a first step and `continueScan(state, options)` the next ones. Each returns `{ done: false, state }` or `{ done: true, result }`. A step has its own allowance: `stepDeadlineMs`, and optionally `stepBudget` requests. When the allowance is used up, the fetcher throws `StepDeadlineError`. That is not a budget error: the interrupted check is not recorded and runs again in the next step.
- **Overall limits keep today's semantics.** The request budget counts across steps. When `maxSteps`, `maxActiveMs` or the stall guard says the next step is the last, that step runs with an ordinary deadline and finishes like `scan()`, skips included.
- **Re-resolve, never serialise the target.** A resolved target holds the home page and the sitemap URL lists, which can run to megabytes, far beyond a database row. Each step resolves the target again (deterministic for the same responses) and takes the earlier outcomes as decided. Re-sent requests (refills) are paced but never counted twice. A request cut off mid-way by a step is rolled back, and counted in full when it completes.
- **Bodies stay with the host.** The state holds versions, settings, counted request keys with their send counts, decided outcomes, politeness and failures. That is a few KiB (2.6 KiB for the recorded WooCommerce store between steps). A host that can keep responses passes a `ResponseCache`. Without one, every step re-reads the pages it needs.
- **Stall guard.** A step that decides no check and counts no new request means the store is too slow for one check to fit in a step without a cache. After `maxStalledSteps` such steps (default 2), the next step finishes the scan instead of spending the remaining steps.
- **Versioned state.** The state names its format and the scanner, catalog and scoring versions. `continueScan` refuses a mismatch with `ScanStateMismatchError`.
- **Same result.** Over the same responses, a stepped scan returns the result of one `scan()` call. Only `scanned_at`, `duration_ms` (the active time of the steps, without the gaps) and the new optional `steps` field differ. A test runs a recorded store in many steps and compares.
- **`scan()` is unchanged.**

## Consequences

- Hosts with a per-invocation limit can finish slow stores instead of recording them as incomplete. The cost is storing a small state and, ideally, a response cache.
- Without a cache, re-resolution costs each step the time of the resolver's requests (home page, robots.txt, sitemaps). On very slow stores that can leave too little room, and the stall guard turns that into the usual skips.
- Responses can change between steps on a live store. A cache makes a stepped scan see one consistent snapshot.
