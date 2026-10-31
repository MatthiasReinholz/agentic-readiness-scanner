# 0006 Monitoring is a weekly rescan with an email on change, behind double opt-in

Date: 2026-10-31. Status: accepted.

## Context

A scan is a snapshot. Stores change under theme updates, plugin changes and platform releases, and the merchant rarely notices that an agent-facing signal broke. The request: let a visitor leave an email address on a report and be told when the result changes.

Constraints: the hosted app runs as a Spacefast Functions worker with a MySQL database behind a D1-shaped binding, outbound `fetch` to public hosts, and crons that call a path on a schedule (`x-spacefast-cron` header, no custom secret on scheduled fires). There is no email service on the platform. The project stores as little personal data as possible.

## Decision

- **One subscription = one address watching one host.** Stored in a `monitors` table with status `pending`, `active` or `unsubscribed`, the canonical URL to rescan, and a compact **baseline** (level, scores, verdict per check, scan id) of the last scan the subscriber was told about. The baseline lives on the subscription, so it survives the scans table's retention purge.
- **Double opt-in.** Signup creates a pending row and sends one confirmation email; nothing else is sent until the link is opened. Re-sending is throttled to once per hour per address and host. Every outcome of a signup shows the same page, so an address cannot be probed.
- **Tokens are hashed.** Confirmation and unsubscribe tokens are 24 random bytes; only their SHA-256 is stored, and comparison is constant-time. The unsubscribe token is rotated with each change email so an old email cannot cancel a newer subscription state.
- **Change detection is a pure function.** `packages/core/src/diff.ts` turns a result into a snapshot and diffs two snapshots (level, both scores, verdict per check, checks that appeared or vanished). The service emails only when the diff reports a change.
- **A daily cron processes what is due.** `/internal/cron/monitor` picks active subscriptions whose last check is older than `MONITOR_INTERVAL_DAYS` (default 7), at most `MONITOR_BATCH_SIZE` (default 10) per run, scans each host once, and emails per subscriber. A failed rescan is recorded as checked so it is retried next interval, not every run. The endpoint is idempotent and cheap when nothing is due, which is the defence against anyone calling it with the cron header.
- **Mail goes through a one-method `Mailer` interface.** `ResendMailer` is the production adapter (HTTP API, one `fetch`); `ConsoleMailer` serves development; `MemoryMailer` serves tests. Monitoring is enabled only when `MAIL_PROVIDER` is set, so a deployment without mail shows no signup UI and no routes.
- **The report offers it twice, politely.** An inline panel between the scores and the sections, and a `<dialog>` after ten seconds that stays away when the visitor subscribed to this host before, dismissed it in the last 30 days, or is already typing in the panel.

## Consequences

- No new infrastructure: two tables, one cron, one outbound API.
- A provider account and a verified sending domain are needed before monitoring goes live; until then the feature is simply off.
- Throughput is bounded by the batch size times the daily cron: 10 per day covers 70 subscriptions on a weekly cadence. Raising the batch size or adding a second cron path is the scaling path; a queue is not needed yet.
- The owner sees subscriptions and every host ever scanned through the token-protected export endpoints (ADR 0006 companion: the `targets` registry) or the Space's database console.
