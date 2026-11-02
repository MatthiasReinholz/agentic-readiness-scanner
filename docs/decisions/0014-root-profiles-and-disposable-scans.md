# 0014 Root URLs have stable profiles; path scans are disposable

Date: 2026-11-02. Status: accepted. Supersedes the scope and concurrency assumptions
of [0009](0009-result-storage-tiers.md); the three result-storage tiers remain.

## Context

A hostname makes a useful public identity for a store. A report ID identifies one
observation and must not start pointing to another scan later. The hosted scanner
previously stored and reused every submitted URL by host, so a path could receive a
root result, contribute to permanent host history, and be saved in progress records.

## Decision

- `/sites/<host>` is the stable public profile and latest root report. Subdomains
  stay separate; the existing `www.`/bare-host alias stays. Hostnames are normalized
  by the URL parser (including internationalized names), lowercased and stripped of
  the trailing dot. The scheme does not create another profile. Host segments avoid
  ambiguities with domains ending in `.md` or `.json`.
- `/r/<random-id>` remains an immutable scan snapshot with its existing formats and
  retention. History and monitoring continue to reference snapshots. Successful root
  submissions return both identities; the browser opens the readable profile URL.
- Persistence is decided from the normalized **submitted** URL, before cache lookup
  or redirects. Only `/` with no query and no non-default port creates persistent
  scan data. Fragments are removed before scanning. A path redirecting to `/` stays
  disposable; a root redirecting to a market page stays a root-started scan. Rescan
  actions preserve the submitted root host, with redirects retained as evidence.
- Path/query scans return results in the POST response, streamed response or hosted
  MCP response. They never write result, history, target, monitoring or progress rows.
  The browser receives the completed report as a direct form POST response, without
  a share URL or stored arrival payload. This works with and without JavaScript. Responses
  use `no-store`; one-time documents use `noindex` and omit canonical/social/schema
  metadata. Application diagnostics log error classes rather than submitted URLs.
- This is a **site scan started from a URL**, not a strict subtree or single-page
  audit. Existing market selection, origin-wide discovery and evidence rules remain.
  The document explains this scope. The published `ScanResult` schema is unchanged.
- Every new scan reserves the submitted host for at least one minute, across root
  and path submissions, HTTP, MCP and monitoring. Root cache hits may replay a stored
  root result without sending requests. A different path receives 429 with retry
  guidance rather than another scope's result. Failed scans consume the minute too.
- Production admission uses an atomic conditional MySQL upsert and a unique claim
  token, then verifies token ownership. The token assignment precedes the timestamp
  assignment. Affected-row counts are not an ownership signal. No read-then-write
  race or release-on-failure is used. The operational table contains only host,
  expiry and random token; cleanup removes expired rows after a day. There is no
  submitted path, query or scan evidence in it. Local development uses memory.

## Consequences

Root profiles are indexable and retain their recorded history after full reports
expire. Profile reads never initiate a scan. Full-report retention is enforced at
lookup as well as by cleanup. Expired profiles explicitly show historical evidence.
Neither dynamic profiles nor snapshots are enumerated in the sitemap.

Earlier stored scans/history are preserved. A legacy latest path result is never
promoted into the latest root report. Aggregated history from before this change can
include path-started scans: expired aggregates no longer contain enough information
to recover their original scope. Such history is labeled, not silently reclassified
or deleted. Legacy redirected rescan destinations are kept attached to the host key.

Disposable requests do not use SQL progress polling, because that would save their
URL-bearing events. The web UI uses a direct form response for this scope; the root-scan console and
its animated handoff remain intact. API clients may stream disposable events/results
without durable polling. A lost disposable response cannot be recovered;
the client does not automatically retry it. Browser-only URLs cannot be shared with
other people. Users can explicitly save/export local output themselves; the app does
not persist it automatically. This policy governs application storage, not a promise
about third-party infrastructure logs or a user's browser history.

The minute applies to **scan submissions**, not each outbound HTTP request inside a
scan. Each scan retains its bounded request budget and honest scanner identity.
`TARGET_COOLDOWN_SECONDS` defaults to 60 and cannot be configured below 60. A larger
configured interval is supported. Database admission is shared across workers; the
overall concurrent-scan cap remains per isolate. Timestamps use the workers' UTC clock.

References: [MySQL conditional upserts](https://dev.mysql.com/doc/refman/8.4/en/insert-on-duplicate.html),
[assignment ordering](https://dev.mysql.com/doc/refman/8.4/en/update.html).
