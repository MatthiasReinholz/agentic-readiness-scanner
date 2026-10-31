import type { ResultStore, StoredScan } from './types.js';

export class MemoryResultStore implements ResultStore {
  private readonly scans = new Map<string, StoredScan>();

  put(scan: StoredScan): Promise<void> {
    this.scans.set(scan.id, scan);
    return Promise.resolve();
  }

  get(id: string): Promise<StoredScan | null> {
    return Promise.resolve(this.scans.get(id) ?? null);
  }

  latestForHost(host: string): Promise<StoredScan | null> {
    let latest: StoredScan | null = null;
    for (const scan of this.scans.values()) {
      if (scan.host === host && (!latest || scan.createdAt > latest.createdAt)) latest = scan;
    }
    return Promise.resolve(latest);
  }

  deleteOlderThan(isoTimestamp: string): Promise<number> {
    let removed = 0;
    for (const [id, scan] of this.scans) {
      if (scan.createdAt < isoTimestamp) {
        this.scans.delete(id);
        removed += 1;
      }
    }
    return Promise.resolve(removed);
  }
}
