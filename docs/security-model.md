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
- The agent-profile comparison (A2.4, not yet implemented) will send other user-agent strings only for one product page and at most six extra requests, and the about page will say so.
- robots.txt is respected for the scanner's own user agent on everything except robots.txt, sitemaps and well-known paths.
- One scan per target host per cooldown window on the hosted app; the stored result is served in between.

## Hosted app

- Scan ids are 16 hex characters from a cryptographic random source and are not listed anywhere.
- Stored results contain only what the report shows: URLs, status codes, excerpts of evidence. No request bodies beyond what the checks quote, no visitor data.
- Reports are kept for `RETENTION_DAYS` and deleted by the cleanup cron, which only runs when the platform's cron header is present.
- Secrets live in Space variables and GitHub environments. The repository holds none.

## Supply chain

- Every GitHub Action is pinned to a full commit SHA; `scripts/ci/check-action-pins.sh` fails otherwise.
- Workflows request the least permissions they need; publishing jobs run in the `production` environment.
- Dependencies are exact-pinned and updated through Dependabot pull requests; dependency review and CodeQL run on every pull request.
- Release assets carry build provenance attestations and npm packages are published with provenance.

## Reporting

See [SECURITY.md](../SECURITY.md).
