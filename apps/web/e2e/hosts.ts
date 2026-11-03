/**
 * Fixture hosts and their roles. Each new scan reserves its host for a minute across
 * all paths, so every test that starts a scan owns a host of its own.
 */
/** Scanned by the server before it answers: report, profile and history pages. */
export const SEEDED_HOST = 'ceramics.example';
/** Left unscanned for the live scan-to-report handoff. */
export const LIVE_SCAN_HOST = 'blog.example';
/** A recorded product page; a path scan yields a disposable report. */
export const DISPOSABLE_SCAN_URL = 'https://boots.example/products/trail-boot';
/** Answers slowly (the recorded blog, renamed), so its scan needs several steps. */
export const STEPPED_SCAN_HOST = 'slow.example';
