# 0017 Hosted scans run as stepped jobs on the server, not in the visitor's browser

Date: 2026-11-03. Status: accepted. Replaces the one-request scan with a single deadline assumed in [0004](0004-spacefast-functions-runtime.md) and [0015](0015-legal-signals.md).

## Context

Spacefast Functions answer every request within 30 seconds. The hosted app therefore gave each scan one request and a wall-clock budget of 24 seconds. Slow stores ran out of it. Their checks were reported as "not run: the scan's time budget of 24 s was used up", and a store that needed all 40 requests had its legal checks skipped for the request budget. [0016](0016-resumable-scans.md) added resumable scans to the core library, but the hosted app still ran each scan in one go.

Two ways out were considered:

- run the scan in steps on the server, or
- move the scanning into the visitor's browser, so the server does less and stores see a browser instead of the scanner's user agent.

## Decision

**Scanning stays on the server, in steps.** A hosted scan is a job: a `scan_jobs` row that holds the resumable state between steps (a few KiB, no response bodies). Each step runs inside one request with an allowance of 20 seconds (`SCAN_STEP_MS`). A check cut off by a step is not skipped. It runs again in the next step. The scan's own limits are 60 requests (`SCAN_BUDGET`, up from 40), 12 steps (`SCAN_MAX_STEPS`) and 3 minutes of active scanning (`SCAN_MAX_ACTIVE_MS`). Only those limits end checks with `budget_exhausted`, and the message names the limit.

**Responses are cached per job.** Each step stores what it fetched in `scan_job_cache`, gzipped, so a 2 MB page fits in one statement. The next step reads it instead of asking the store again. The cache is removed when the job ends, and by the cleanup cron after 2 hours. A response that does not fit, or a write that fails, only means the next step fetches it again, and the budget never counts it twice.

**Four triggers keep a scan going.** Any of them runs the next step. A lease on the job row makes sure only one step runs at a time. The lease is taken with a conditional UPDATE and read back, like the scan limiter. A caller that finds the lease taken gets the job back as busy.

1. **The page.** The home page console runs the first step through `/api/scan/stream`. When the stream ends with `paused`, the page calls `POST /api/scan/jobs/<id>/continue` until the scan is done. The form without JavaScript lands on `/scan/jobs/<id>`, which does the same from a small script, or reloads every 10 seconds when scripts do not run.
2. **The app itself.** After a step pauses, the worker asks itself for the next step in a request of its own (`ctx.waitUntil` with a fetch to the continue endpoint). This is best effort. The platform does not document `waitUntil`, so the other triggers do not depend on it.
3. **The sweeper cron.** `/internal/cron/scan-jobs` fires every hour. It runs the next step of running jobs that nobody advanced for 25 seconds, oldest first, as many as fit in its request. It is the backstop, not the engine: Spacefast refuses crontab schedules ("Crontab expressions are not supported", although its docs list them), so hourly is the finest schedule it takes.
4. **The next request.** A later request for the same root joins the running job by running its next step, instead of being refused.

**Safety rails.**

- A lease outlives its step by 15 seconds, so a step the platform cut off frees the job soon.
- A job claimed three times without a saved step fails, with a message the page shows.
- The cleanup cron fails a job that is still running after 30 minutes.
- A deploy between two steps (`ScanStateMismatchError`) restarts the scan from the job's cache.
- API callers get `202` with `status_url` and `continue_url` when a scan needs more steps.
- MCP returns a tool error that says to call again.
- Monitoring leaves the subscription due and reuses the finished scan on its next run.

**Why not the browser.** On 2026-11-03 a page on the live app tried to read store responses with `fetch` from the visitor's browser. The home pages, robots.txt files and sitemaps of every store tried were unreadable. A browser hands a page a response from another site only when that site sends CORS headers (Cross-Origin Resource Sharing, the headers with which a server lets other sites' pages read its responses), and stores do not send them for HTML, robots.txt or sitemaps. Only API endpoints that opt into CORS were readable: the WordPress REST index, Shopify's `products.json` and a UCP manifest (UCP is the Universal Commerce Protocol, an open standard for agents to discover and buy from stores). `mode: 'no-cors'` returns an opaque response with no status and no body. A hidden iframe gives no access to a document from another site, and many stores forbid framing anyway. A popup window has the same boundary. So:

- Most checks would still need the server, which would have to fetch for the browser as a proxy. That keeps the load on the server and the requests on its network, and only moves the parsing.
- The only browser-side route that reads responses from other sites is a browser extension with host permissions. It cannot run for a visitor who has not installed it.
- Results computed in a browser are whatever the browser sends, so anyone could submit fabricated ones. The safeguards considered against fake data were: never let a browser result overwrite stored values, rerun the scan on the server instead, and accept browser results only for hosts with no data yet. They would still let anyone publish a fabricated first profile for any host nobody had scanned yet. Where the server is blocked, the block would stay the primary result, and a browser result would only be an enrichment beside it.

The reasoning for store owners and agents is in the guide [Why the scanner reports crawler blocks instead of scanning from your browser](../../packages/catalog/knowledge/guides/crawler-blocks-and-browser-scans.md), published at `/knowledge-base/guides/crawler-blocks-and-browser-scans`.

## Consequences

- Slow stores finish. The scan that used to stop at 24 seconds runs in as many steps as it needs, within the overall limits, and the report and scores cover the whole catalog.
- A scan can take a few minutes of wall time on slow stores. With the page open, steps follow each other at once. With the page closed, the app calling itself carries the scan. Where that fails, the sweeper runs one step an hour and a scan can take hours, which is why the next request for the same root also runs a step. The console says which step it is on.
- Every step re-resolves the target ([0016](0016-resumable-scans.md)). With the cache, that costs database reads, not store requests.
- Scans still come from the server with the scanner's user agent. Stores that refuse it at the edge are reported as refusing it (check A2.4), which is what an agent would meet.
- One-time scans (paths and queries, [0014](0014-root-profiles-and-disposable-scans.md)) still write no result, profile, history or progress. But one that needs several steps has a job row while it runs: its state, cached responses and finally its result. The row is deleted when the result is delivered (the waiting page or the job's status endpoint shows it), and once it is an hour old, by the sweeper's next hourly run.
- New tables: `scan_jobs` (rows removed a day after a job ends) and `scan_job_cache`. New cron: hourly.
