# Security model

The scanner fetches URLs that strangers type in. That makes it a server-side request forgery and scraping vector by construction. These controls are release blockers, not nice-to-haves.

## URL policy

`packages/core/src/http/url-policy.ts` rejects before any request is made:

- schemes other than `http` and `https`
- ports other than the defaults
- credentials in the URL
- `localhost`, single-label hostnames, and `.local`, `.internal`, `.localhost`, `.home.arpa`, `.intranet`, `.lan`
- private, loopback, link-local, carrier-grade NAT, multicast and reserved IPv4 ranges, and their IPv6 and IPv4-mapped equivalents

Every redirect hop is checked again. DNS resolution happens on the platform, so resolution-time protection against private addresses depends on the host's outbound policy; see [hosting.md](hosting.md).

## Budget and caps

- At most 40 requests per scan, redirects included, enforced by the fetcher; a check that runs out is skipped as `budget_exhausted` and the report says so.
- 10 second timeout per request, 2 MB body cap, 5 redirects.
- Sequential requests, no parallel fan-out against a target.

## Honest behavior toward targets

- User agent `AgenticReadinessScanner/<version> (+repository URL)` on every request the scanner makes for itself.
- The agent-profile comparison (A2.4, not yet implemented) will send other user-agent strings only for one product page and at most six extra requests, and `llms.txt` and this document will say so.
- robots.txt: the scanner parses and evaluates it for the checks. Honouring it for the scanner's own fetches (everything except robots.txt, sitemaps and well-known paths) is not implemented yet and is the next hardening step.
- One scan per target host per cooldown window on the hosted app; the stored result is served in between.

## Hosted app

- Scan ids are 16 hex characters from a cryptographic random source and are not listed anywhere.
- Stored results contain only what the report shows: URLs, status codes, excerpts of evidence. No request bodies beyond what the checks quote, no visitor data.
- Reports are kept for `RETENTION_DAYS` and deleted by the cleanup cron, which only runs when the platform's cron header is present. The `targets` registry keeps one row per host (no visitor data) indefinitely so the owner can see what was scanned.
- Secrets live in Space variables. The repository holds none.

## Monitoring and personal data

Monitoring is the only feature that stores personal data: an email address bound to one host.

- Double opt-in: nothing but one confirmation email is sent before the address confirms; re-sending is throttled to once per hour.
- Confirmation and unsubscribe tokens are 24 random bytes; only their SHA-256 is stored, comparison is constant-time, and the unsubscribe token is rotated with every change email.
- Every email carries an unsubscribe link; unsubscribing is one click and keeps the row only to honour the choice.
- Signup always shows the same page whatever the address's state, so addresses cannot be enumerated.
- The weekly check runs under the platform's cron header, is idempotent, and processes at most `MONITOR_BATCH_SIZE` due subscriptions per run.
- Owner exports require a bearer `ADMIN_TOKEN` and omit token hashes; without the variable the endpoints do not exist.

## Supply chain

- Every GitHub Action is pinned to a full commit SHA; `scripts/ci/check-action-pins.sh` fails otherwise.
- Workflows request the least permissions they need; the release workflow is the only one with write permissions and runs only on merged release pull requests.
- Dependencies are exact-pinned and updated through Dependabot pull requests; dependency review and CodeQL run on every pull request.
- Release assets carry build provenance attestations and npm packages are published with provenance.

## Reporting

See [SECURITY.md](../SECURITY.md).
