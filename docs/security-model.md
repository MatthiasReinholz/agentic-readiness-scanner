# Security model

The scanner fetches URLs that strangers type in. That makes it a server-side request forgery and scraping vector by construction. These controls are release blockers, not nice-to-haves.

## URL policy

`packages/core/src/http/url-policy.ts` rejects before any request is made:

- schemes other than `http` and `https`
- ports other than the defaults
- credentials in the URL
- `localhost`, single-label hostnames, and `.local`, `.internal`, `.localhost`, `.home.arpa`, `.intranet`, `.lan`
- private, loopback, link-local, carrier-grade NAT, multicast and reserved IPv4 ranges, and their IPv6 and IPv4-mapped equivalents

Every redirect hop is checked again. DNS resolution happens on the platform, so resolution-time protection against private addresses depends on the host's outbound policy; see [hosting.md](hosting.md). That platform-level block was verified on 2026-10-31: scans of `http://127.0.0.1.nip.io/` and `http://10.0.0.1.nip.io/` on the live deployment both failed with HTTP 530 from the platform.

Response bodies are decoded with the charset the `Content-Type` header declares, falling back to UTF-8 for unknown labels, so a page's declared encoding cannot make the scanner misread it. A body served as a gzip file (`application/gzip`, a `.gz` path or the gzip magic bytes, as the sitemaps protocol allows) is inflated first, and the 2 MB cap applies to the inflated bytes.

## Budget and caps

- At most 40 requests per scan, redirects and retries included, enforced by the fetcher; a check that runs out is skipped as `budget_exhausted` and the report says so.
- 10 second timeout per request, 2 MB body cap (applied to the inflated bytes when a sitemap is served as a gzip file), 5 redirects.
- Sequential requests with at least 150 ms between them, no parallel fan-out against a target. One retry per request: after 500 ms when the connection dropped, after `Retry-After` on a 429 or 503 when it is five seconds or less (one second when absent), never beyond the budget. After a 429 the interval grows to one second, then four, for the rest of the scan. Every request that still failed, and every 429, is listed under the scan warnings.
- GET, HEAD and OPTIONS only, with one exception: a read-only JSON-RPC `server/discover` POST to an MCP endpoint the site itself advertises (checks A4.4 and B5.8). It creates nothing on the server.

## Honest behavior toward targets

- User agent `AgenticReadinessScanner/<version> (+repository URL)` on every request, without exception.
- Besides the pages a scan samples, the scanner fetches the `http://` form of the origin and the other host variant (`www` or apex) once each to see whether they redirect (A3.7), and repeats one product-page request with `If-None-Match` or `If-Modified-Since` to see whether the server answers 304 (A3.9). Both go through the URL policy like every other request; `http://` is allowed only for that probe's first hop and the response is never used as content. The scanner never sends another agent's product token: the block-and-challenge check (A2.4) classifies the responses the scan made under its own identity, and robots.txt is evaluated for other crawlers from the file ([decision 0010](decisions/0010-honest-fetch.md)).
- robots.txt is honoured for the scanner's own user agent (`AgenticReadinessScanner`) on everything except robots.txt, sitemaps and the well-known directory: `RobotsGatedFetcher` refuses disallowed URLs without spending budget, the affected checks quote the refusal (`not fetched: robots.txt disallows <path> for AgenticReadinessScanner`), and the report lists the refused URLs under scan warnings.
- One scan per target host per cooldown window on the hosted app, whatever the caller asks for: a profile override does not reopen the window, parallel submissions for one host share a single scan, and an isolate runs at most four scans at once (503 beyond that). This is the only control against using the scanner as a request amplifier, since the platform exposes no client address.

## Hosted app

- Scan ids are 16 hex characters from a cryptographic random source and are not listed anywhere.
- Stored results contain only what the report shows: URLs, status codes, excerpts of evidence. No request bodies beyond what the checks quote, no visitor data.
- Reports are kept for `RETENTION_DAYS` and deleted by the cleanup cron, which only runs when the platform's cron header is present. The `targets` registry keeps one row per host and the `scan_history` table one row per distinct state per host (level, scores, verdict per check; no evidence, no visitor data) indefinitely, so the owner can see what was scanned and anyone can see how a host developed ([decision 0009](decisions/0009-result-storage-tiers.md)).
- Secrets live in Space variables. The repository holds none.

## Monitoring and personal data

Monitoring is the only feature that stores personal data: an email address bound to one host.

- Double opt-in: nothing but one confirmation email is sent before the address confirms; re-sending is throttled to once per hour.
- Confirmation and unsubscribe tokens are 24 random bytes; only their SHA-256 is stored, comparison is constant-time, and the unsubscribe token is rotated with every change email.
- Every email carries an unsubscribe link; unsubscribing is one click and keeps the row only to honour the choice.
- Signup always shows the same page whatever the address's state, so addresses cannot be enumerated.
- The weekly check runs under the platform's cron header. Scheduled fires carry only that header, which any client can set, so the endpoint is built to be harmless when called by anyone: rows are claimed before work, nothing is due more than once per interval, at most `MONITOR_BATCH_SIZE` subscriptions are processed per run, and an isolate refuses to run again within ten minutes.
- Confirmation emails are capped at five per address per day; unconfirmed requests are deleted after 48 hours by the cleanup cron.
- Monitoring refuses to start unless `APP_BASE_URL` is set, so email links are never derived from a request's Host header.
- Owner exports require a bearer `ADMIN_TOKEN` and omit token hashes; without the variable the endpoints do not exist.

## Supply chain

- Every GitHub Action is pinned to a full commit SHA; `scripts/ci/check-action-pins.sh` fails otherwise.
- Workflows request the least permissions they need; the release workflow is the only one with write permissions and runs only on merged release pull requests.
- Dependencies are exact-pinned and updated through Dependabot pull requests; dependency review and CodeQL run on every pull request.
- Release assets carry build provenance attestations and npm packages are published with provenance.

## Reporting

See [SECURITY.md](../SECURITY.md).
