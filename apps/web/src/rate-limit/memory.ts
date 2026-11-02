import type { ScanLimiter, ScanLimit } from './types.js';

/** Local/test implementation; production uses the SQL claim shared by server instances. */
export class MemoryScanLimiter implements ScanLimiter {
  private readonly nextAt = new Map<string, number>();

  acquire(host: string, now: Date, intervalSeconds: number): Promise<ScanLimit> {
    const time = now.getTime();
    // Expired reservations carry no useful state; keep a long-lived dev instance bounded.
    for (const [key, next] of this.nextAt) if (next <= time) this.nextAt.delete(key);
    const retryAfterSeconds = Math.max(0, Math.ceil(((this.nextAt.get(host) ?? 0) - time) / 1000));
    if (retryAfterSeconds > 0) return Promise.resolve({ allowed: false, retryAfterSeconds });
    this.nextAt.set(host, time + Math.max(60, intervalSeconds) * 1000);
    return Promise.resolve({ allowed: true, retryAfterSeconds: 0 });
  }

  deleteOlderThan(isoTimestamp: string): Promise<number> {
    let removed = 0;
    for (const [host, next] of this.nextAt) {
      if (next < Date.parse(isoTimestamp)) {
        this.nextAt.delete(host);
        removed += 1;
      }
    }
    return Promise.resolve(removed);
  }
}
