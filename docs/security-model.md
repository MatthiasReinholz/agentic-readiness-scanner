# Security model

The scanner fetches URLs that strangers type in. By construction, that makes it a vector for server-side request forgery (tricking a server into fetching internal addresses) and for scraping. The controls below are release blockers, not nice-to-haves.

## URL policy

`packages/core/src/http/url-policy.ts` rejects these before any request is made:

- schemes other than `http` and `https`
- ports other than 80 and 443
- credentials in the URL
- `localhost`, single-label hostnames, and names ending in `.local`, `.internal`, `.localhost`, `.home.arpa`, `.intranet` or `.lan`
- private, loopback, link-local, carrier-grade NAT, multicast and reserved IPv4 ranges
- the IPv6 unspecified and loopback addresses, unique local (`fc00::/7`) and link-local (`fe80::/10`) addresses, and IPv4-mapped forms of the blocked IPv4 ranges

Every redirect hop is checked again. DNS resolution happens on the platform, so protection against names that resolve to private addresses depends on the host's outbound policy (see [hosting.md](hosting.md)). That platform-level block was verified on 2026-10-31: scans of `http://127.0.0.1.nip.io/` and `http://10.0.0.1.nip.io/` on the live deployment both failed with HTTP 530 from the platform.

Response bodies are decoded with the charset the `Content-Type` header declares, falling back to UTF-8 for unknown labels, so a page's declared encoding cannot make the scanner misread it. A body served as a gzip file (`application/gzip`, a `.gz` path or the gzip magic bytes, as the sitemaps protocol allows) is inflated first, and the 2 MB cap applies to the inflated bytes.

## Budget and caps

- A scan sends at most 40 requests by default (60 on the hosted scanner), redirects and retries included. The fetcher enforces this across all steps of a scan. The CLI sets it with `--budget`, the hosted scanner with `SCAN_BUDGET`.
- The hosted scanner runs a scan in steps of 20 s, each inside one request (the platform answers within 30 s), up to 12 steps and 3 minutes of active scanning. A check that runs out of the request budget or those overall limits is skipped as `budget_exhausted`, and the report says which limit. A step that runs out of time is not a skip: its check runs again in the next step.
- Each request has a 10 second timeout (`--timeout` in the CLI), a 2 MB body cap and at most 5 redirects.
- Requests are sequential, with at least 150 ms between them, and never fan out in parallel against a target.
- Each request is retried at most once, and never beyond the budget. After a dropped connection the retry waits 500 ms. After a 429 or 503 it waits what `Retry-After` asks when that is five seconds or less, and one second when the header is absent. A longer `Retry-After` is honoured by not retrying.
- After a 429 the interval between requests grows to one second, then two, for the rest of the scan. Once a 429 persists after its retry, later 429s are not retried. After three persistent 429s the scan stops and the remaining checks say so. Every request that still failed, and every 429, is listed under the scan warnings.
- The scanner sends GET, HEAD and OPTIONS only, with one exception: a read-only JSON-RPC `server/discover` POST to an MCP endpoint (Model Context Protocol, the standard way AI agents call tools) that the site or its platform documents. Checks A4.4, A4.8, B5.8 and B5.9 send it. If the server refuses it with a plain HTTP 400, as servers on the 2025 session transport do, the scanner sends the `initialize` handshake once instead. Neither creates anything on the server beyond the session the handshake opens.

## Honest behaviour toward targets

- Every request carries the user agent `AgenticReadinessScanner/<version> (+https://github.com/MatthiasReinholz/agentic-readiness-scanner)`, without exception. The default `Accept` header is the one a browser sends.
- The scanner never runs JavaScript, never signs in and never sends another agent's product token. The block-and-challenge check (A2.4) classifies the responses the scan received under its own identity. robots.txt rules for other crawlers are evaluated from the file ([decision 0010](decisions/0010-honest-fetch.md)).
- Besides the pages a scan samples, the scanner fetches the `http://` form of the origin and the other host variant (`www` or apex) once each, to see whether they redirect (A3.7). It also repeats one product-page request with `If-None-Match` or `If-Modified-Since`, to see whether the server answers 304 (A3.9). Both go through the URL policy like every other request, and the check reads only the status and where they redirect.
- robots.txt (the file that tells crawlers what they may fetch) is honoured for the scanner's own token, `AgenticReadinessScanner`. The rules apply to everything except robots.txt itself, sitemaps (paths ending in `.xml` or `.xml.gz`) and the `/.well-known/` directory. The home page is fetched before robots.txt is read. `RobotsGatedFetcher` refuses disallowed URLs without spending budget. The affected checks quote the refusal (`not fetched: robots.txt disallows <path> for AgenticReadinessScanner`), and the report lists the refused URLs under scan warnings.
- The hosted scanner starts at most one scan per target host per cooldown window (60 s by default), whatever the caller asks for. A profile override does not reopen the window, and parallel root submissions for one host share a single scan. An isolate runs at most four scan steps at once and answers 503 beyond that. This is the only control against using the scanner as a request amplifier, since the platform exposes no client address.

## Hosted scanner

- Scan ids are 16 hex characters from a cryptographic random source. No page lists them all. A profile page links its own snapshot.
- Stored results contain only what the report shows: URLs, status codes and excerpts of evidence. They hold no request bodies beyond what the checks quote and no visitor data.
- Scan progress (the same phase and verdict events the report contains, under a random token the page generates) is kept in `scan_progress` only for root scans. The cleanup cron removes it an hour after its last update.
- Full reports are kept for `RETENTION_DAYS` (30 by default). Reads refuse older ones, and the cleanup cron deletes them. The cron runs only when the platform's cron header is present. The `targets` registry keeps one row per host, and the `scan_history` table one row per distinct state per host (level, scores, verdict per check, no evidence, no visitor data), indefinitely. So the owner can see what was scanned, and anyone can see how a host developed ([decision 0009](decisions/0009-result-storage-tiers.md)).
- One-time scans (a path or a query string) store no result. A one-time scan that needs several steps keeps its state on the server only until the result is delivered, and an hourly sweep removes any such state older than an hour.
- Legal-signal pages (`/sites/<host>/legal`, `/r/<id>/legal`) are sent with `noindex, nofollow, noarchive` and disallowed in the app's robots.txt.
- Secrets live in Space variables. The repository holds none.

## Monitoring and personal data

Monitoring is the only feature that stores personal data: an email address bound to one host. It is off unless a mail provider and `APP_BASE_URL` are configured.

- Double opt-in: nothing but one confirmation email is sent before the address confirms. Re-sending is throttled to once per hour.
- Confirmation and unsubscribe tokens are 24 random bytes. Only their SHA-256 is stored, comparison is constant-time, and the unsubscribe token is rotated with every change email.
- Every email carries an unsubscribe link. Unsubscribing is one click and keeps the row only to honour the choice.
- Signup always shows the same page, whatever the address's state, so addresses cannot be enumerated.
- The weekly check runs under the platform's cron header. Scheduled fires carry only that header, which any client can set, so the endpoint is built to be harmless when anyone calls it. Rows are claimed before work, nothing is due more than once per interval, at most `MONITOR_BATCH_SIZE` subscriptions are processed per run, and an isolate refuses to run again within ten minutes.
- Confirmation emails are capped at five per address per day. The cleanup cron deletes unconfirmed requests after 48 hours.
- Monitoring refuses to start unless `APP_BASE_URL` is set, so email links are never derived from a request's Host header.
- Owner exports require a bearer `ADMIN_TOKEN` and omit token hashes. Without the variable the endpoints do not exist.

## Supply chain

- Every GitHub Action is pinned to a full commit SHA. `scripts/ci/check-action-pins.sh` fails otherwise.
- Workflows request the least permissions they need. The CI and dependency-review workflows can only read the repository. CodeQL can also write security alerts. `prepare-release` can push a release branch and open its pull request, and it runs only when started by hand. `finalize-release` gets write, OpenID Connect and attestation permissions only in its job, which runs only on a merged `release/` or `hotfix/` pull request from this repository.
- Dependencies are exact-pinned and updated through weekly Dependabot pull requests. Dependency review and CodeQL run on every pull request.
- Release assets carry build provenance attestations, and npm packages are published with provenance.

## Reporting

See [SECURITY.md](../SECURITY.md).
