# 0014 Root URLs have stable profiles, and path scans are disposable

Date: 2026-11-02. Status: accepted. Supersedes the scope and concurrency assumptions of [0009](0009-result-storage-tiers.md). The three result-storage tiers remain.
Amended by [0017](0017-stepped-hosted-scans.md): a one-time scan that needs several steps keeps a job row (its state, cached responses and result) while it runs. The row is deleted when the result is delivered, or after an hour.

## Context

The hosted scanner keeps results per host: a report, a history of states and monitoring ([0006](0006-monitoring-by-weekly-rescan.md), [0009](0009-result-storage-tiers.md)). A hostname makes a useful public identity for a store. A report ID identifies one observation and must not later point to another scan.

Until this decision, the hosted scanner stored and reused every submitted URL by host. A scan of a path (for example `https://example.com/shop/`) could therefore receive a root result, add to the host's permanent history, and be saved in progress records.

## Decision

- **Profiles.** `/sites/<host>` is the stable public profile and the latest root report. Subdomains stay separate. The existing alias between `www.` and the bare host stays. Hostnames are normalised by the URL parser (including internationalised names), lowercased and stripped of a trailing dot. The scheme does not create another profile. Host segments avoid ambiguity with domains ending in `.md` or `.json`.
- **Snapshots.** `/r/<random-id>` stays an immutable snapshot of one scan, with its existing formats and retention. History and monitoring continue to reference snapshots. A successful root submission returns both identities, and the browser opens the readable profile URL.
- **What persists.** Persistence is decided from the normalised **submitted** URL, before the cache lookup or redirects. Only `/` with no query and no non-default port creates persistent scan data. Fragments are removed before scanning. A path that redirects to `/` stays disposable. A root that redirects to a market page stays a root-started scan. Rescan actions keep the submitted root host, and redirects are retained as evidence.
- **Disposable scans.** Scans of a path or a query return results in the POST response, the streamed response or the hosted MCP response. They never write result, history, target, monitoring or progress rows. The browser receives the completed report as a direct response to the form POST, without a share URL or a stored arrival payload. This works with and without JavaScript. Responses use `no-store`. One-time documents use `noindex` and omit canonical, social and schema metadata. Application diagnostics log error classes, not submitted URLs.
- **Scope.** This is a **site scan started from a URL**, not an audit of a strict subtree or a single page. The existing market selection, origin-wide discovery and evidence rules remain. The document explains this scope. The published `ScanResult` schema is unchanged.
- **One minute per host.** Every new scan reserves the submitted host for at least one minute, across root and path submissions, HTTP, MCP and monitoring. A root cache hit may replay a stored root result without sending requests. A different path receives 429 with retry guidance rather than another scope's result. Failed scans consume the minute too.
- **Admission.** In production, the decision whether a new scan may start uses an atomic conditional MySQL upsert and a unique claim token, then verifies that it owns the token. The token assignment comes before the timestamp assignment. Affected-row counts are not used as an ownership signal. There is no read-then-write race and no release on failure. The operational table holds only the host, the expiry and the random token, and cleanup removes expired rows after a day. It holds no submitted path, query or scan evidence. Local development uses memory.

## Consequences

Root profiles are indexable and keep their recorded history after the full reports expire. Reading a profile never starts a scan. Full-report retention is enforced at lookup as well as by cleanup. An expired profile states that it shows historical evidence. Neither dynamic profiles nor snapshots are listed in the sitemap.

Earlier stored scans and history are preserved. A legacy latest path result is never promoted to the latest root report. Aggregated history from before this change can include path-started scans, because expired aggregates no longer hold enough information to recover their original scope. Such history is labelled, not silently reclassified or deleted. Legacy redirected rescan destinations stay attached to the host key.

Disposable requests do not use SQL progress polling, because that would save their URL-bearing events. The web UI uses a direct form response for this scope. The root-scan console and its animated handoff remain intact. API clients may stream disposable events and results without durable polling. A lost disposable response cannot be recovered, and the client does not retry it automatically. Browser-only URLs cannot be shared with other people. Users can save or export the output themselves, but the app does not persist it. This policy governs application storage. It is not a promise about third-party infrastructure logs or a user's browser history.

The minute applies to **scan submissions**, not to each outbound HTTP request inside a scan. Each scan keeps its bounded request budget and honest scanner identity. `TARGET_COOLDOWN_SECONDS` defaults to 60 and cannot be configured below 60. A larger interval is supported. Database admission is shared across workers, but the overall cap on concurrent scans stays per isolate. Timestamps use the workers' UTC clock.

References: [MySQL conditional upserts](https://dev.mysql.com/doc/refman/8.4/en/insert-on-duplicate.html), [assignment ordering](https://dev.mysql.com/doc/refman/8.4/en/update.html).
