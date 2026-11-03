# 0017 Hosted scans run as stepped jobs on the server, not in the visitor's browser

Date: 2026-11-03. Status: accepted.

## Context

Spacefast Functions answer every request within 30 seconds, so the hosted app gave each scan one request and a 24 second wall-clock budget. Slow stores ran out of it: checks were reported as "not run: the scan's time budget of 24 s was used up", and a store that needed all 40 requests had legal checks skipped for the request budget. Decision 0016 added resumable scans to the core library; the hosted app still ran each scan in one go.

Two ways out were considered: run the scan in steps on the server, or move the scanning into the visitor's browser so the server does less and stores see a browser instead of the scanner's user agent.

## Decision

**Scanning stays on the server, in steps.** A hosted scan is a job: a `scan_jobs` row that holds the resumable state between steps (a few KiB, no response bodies). Each step runs inside one request with a 20 second allowance (`SCAN_STEP_MS`). A check cut off by a step is not skipped; it runs again in the next step. The scan's own limits are 60 requests (`SCAN_BUDGET`, up from 40), 12 steps (`SCAN_MAX_STEPS`) and 3 minutes of active scanning (`SCAN_MAX_ACTIVE_MS`). Only those end checks with `budget_exhausted`, and the message names the limit.

**Responses are cached per job.** Each step stores what it fetched in `scan_job_cache`, gzipped (a 2 MB page fits in one statement), so the next step reads it instead of asking the store again. The cache is removed when the job ends and by the cleanup cron after two hours. A response that does not fit, or a write that fails, only means the next step fetches it again, and the budget never counts it twice.

**Four triggers keep a scan going.** Any of them runs the next step; a lease on the job row (taken with a conditional UPDATE and read back, like the scan limiter) makes sure only one step runs at a time, and a caller that finds the lease taken gets the job back as busy:

1. **The page.** The home page console runs the first step through `/api/scan/stream`. When the stream ends with `paused`, the page calls `POST /api/scan/jobs/<id>/continue` until the scan is done. The no-JavaScript form lands on `/scan/jobs/<id>`, which does the same from a small script and reloads every 10 seconds without one.
2. **The app itself.** After a step pauses, the worker asks itself for the next step in a request of its own (`ctx.waitUntil` with a fetch to the continue endpoint). This is best effort: the platform does not document `waitUntil`, so the other triggers do not depend on it.
3. **The sweeper cron.** `/internal/cron/scan-jobs` fires every hour and runs the next step of running jobs nobody advanced for 25 seconds, oldest first, as many as fit in its request. It is the backstop, not the engine: Spacefast refuses crontab schedules ("Crontab expressions are not supported", although its docs list them), so hourly is the finest it takes.
4. **The next request.** A later request for the same root joins the running job by running its next step, instead of being refused.

**Safety rails.** A lease outlives its step by 15 seconds, so a step the platform cut off frees the job soon. A job claimed three times without a saved step fails with a message the page shows. A job still running after 30 minutes is failed by the cleanup cron. A deploy between two steps (`ScanStateMismatchError`) restarts the scan from the job's cache. API callers get `202` with `status_url` and `continue_url` when a scan needs more steps; MCP returns a tool error that says to call again; monitoring leaves the subscription due and reuses the finished scan on its next run.

**Why not the browser.** On 2026-11-03 a page on the live app tried to read store responses with `fetch` from the visitor's browser. Home pages, robots.txt and sitemaps of every store tried were unreadable: browsers only hand a page a cross-origin response when the store sends CORS headers, and stores do not send them for HTML, robots.txt or sitemaps. Only API endpoints that opt into CORS were readable (the WordPress REST index, Shopify's `products.json`, a UCP manifest). `mode: 'no-cors'` returns an opaque response with no status and no body, and a hidden iframe gives no access to a cross-origin document (many stores also forbid framing). A popup window has the same boundary. So:

- Most checks would still need the server, which would have to fetch for the browser as a proxy. That keeps the load on the server and the requests on its egress, and only moves the parsing.
- The only browser-side route that reads cross-origin responses is a browser extension with host permissions. It cannot run for a visitor who has not installed it.
- Results computed in a browser are whatever the browser sends. Storing them would need the safeguards considered for this (never overwrite a stored profile, rerun such results on the server), and even then a first, fake result could be published for any host nobody had scanned yet.

## Consequences

- Slow stores finish: the scan that used to stop at 24 seconds runs in as many steps as it needs, within the overall limits, and the report and scores cover the whole catalog.
- A scan can take a few minutes of wall time on slow stores. With the page open, steps follow each other at once. With the page closed, the app calling itself carries the scan; where that fails, the sweeper runs one step an hour and a scan can take hours, which is why the next request for the same root also runs a step. The console says which step it is on.
- Every step re-resolves the target (decision 0016); with the cache that costs database reads, not store requests.
- Scans still come from the server with the scanner's user agent. Stores that refuse it at the edge are reported as refusing it (check A2.4), which is what an agent would meet.
- One-time scans (paths and queries, decision 0014) still write no result, profile, history or progress, but one that needs several steps has a job row while it runs: its state, cached responses and finally its result. The row is deleted when the result is delivered (the waiting page or the job's status endpoint shows it) and once it is an hour old, by the sweeper's next hourly run.
- New tables: `scan_jobs` (removed a day after a job ends) and `scan_job_cache`. New cron: hourly.
