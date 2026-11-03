# 0006 Monitoring is a weekly rescan with an email on change, behind double opt-in

Date: 2026-10-31. Status: accepted.

## Context

A scan is a snapshot. Stores change with theme updates, plugin changes and platform releases, and the merchant rarely notices when a signal that agents rely on breaks. The request: let a visitor leave an email address on a report and be told when the result changes.

The constraints:

- The hosted app runs as a Spacefast Functions worker with a MySQL database behind a D1-shaped binding and outbound `fetch` to public hosts.
- Crons call a path on a schedule. A scheduled call carries an `x-spacefast-cron` header but no custom secret.
- The platform has no email service.
- The project stores as little personal data as possible.

## Decision

- **One subscription is one address watching one host.** It is stored in a `monitors` table with a status (`pending`, `active` or `unsubscribed`), the canonical URL to rescan, and a compact **baseline**: the level, scores, verdict per check and scan id of the last scan the subscriber was told about. The baseline lives on the subscription, so it survives the retention purge of the scans table.
- **Double opt-in.** Signup creates a pending row and sends one confirmation email. Nothing else is sent until the subscriber opens the link. Re-sending is throttled to once per hour per address and host. Every signup outcome shows the same page, so nobody can probe whether an address is subscribed.
- **Tokens are hashed.** Confirmation and unsubscribe tokens are 24 random bytes. Only their SHA-256 hash is stored, and comparison is constant-time. The unsubscribe token is rotated with each change email, so an old email cannot cancel a newer subscription state.
- **Change detection is a pure function.** `packages/core/src/diff.ts` turns a result into a snapshot and compares two snapshots: level, both scores, the verdict per check, and checks that appeared or vanished. The service sends email only when the comparison reports a change.
- **A daily cron processes what is due.** `/internal/cron/monitor` picks active subscriptions whose last check is older than `MONITOR_INTERVAL_DAYS` (default 7), at most `MONITOR_BATCH_SIZE` (default 10) per run. It scans each host once and emails each subscriber. A failed rescan is recorded as checked, so it is retried at the next interval, not on every run. The endpoint is idempotent and cheap when nothing is due, which is the defence against anyone calling it with the cron header.
- **Mail goes through a one-method `Mailer` interface.** `BrevoMailer` is the production adapter: one `fetch` to Brevo's transactional HTTP API. Brevo was chosen for its EU base and a free tier of about 300 emails a day, ample for change-only notifications. `ResendMailer` is kept as a second adapter, `ConsoleMailer` serves development and `MemoryMailer` serves tests. Monitoring is enabled only when `MAIL_PROVIDER` is set. A deployment without mail shows no signup form and has no monitoring routes.
- **The report offers it twice, politely.** An inline panel sits between the scores and the sections. A `<dialog>` opens after 10 seconds, unless the visitor subscribed to this host before, dismissed the dialog in the last 30 days, or is already typing in the panel.

## Consequences

- No new infrastructure: 2 tables, 1 cron, 1 outbound API.
- Monitoring needs a provider account and a verified sending domain before it goes live. Until then the feature is off.
- Throughput is the batch size times one daily cron run: 10 per day covers 70 subscriptions on a weekly cadence. To scale, raise the batch size or add a second cron path. A queue is not needed yet.
- The owner sees subscriptions and every host ever scanned through the token-protected export endpoints or the Space's database console. The export endpoints also serve the `targets` registry introduced alongside this decision.
