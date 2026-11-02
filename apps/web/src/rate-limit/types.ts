/** Operational cooldown only: implementations never receive a submitted path or result. */
export interface ScanLimit {
  allowed: boolean;
  retryAfterSeconds: number;
}

export interface ScanLimiter {
  /** Atomically reserves one scan for a host. A failed scan still consumes its reservation. */
  acquire(host: string, now: Date, intervalSeconds: number): Promise<ScanLimit>;
  deleteOlderThan(isoTimestamp: string): Promise<number>;
}
