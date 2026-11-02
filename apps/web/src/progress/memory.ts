import type { ProgressRecord, ProgressStore } from './types.js';

/** In-process progress for development and tests. */
export class MemoryProgressStore implements ProgressStore {
  private readonly records = new Map<string, ProgressRecord>();

  save(token: string, record: ProgressRecord): Promise<void> {
    this.records.set(token, { ...record, events: [...record.events] });
    return Promise.resolve();
  }

  load(token: string): Promise<ProgressRecord | null> {
    return Promise.resolve(this.records.get(token) ?? null);
  }

  deleteOlderThan(isoTimestamp: string): Promise<number> {
    let removed = 0;
    for (const [token, record] of this.records) {
      if (record.updatedAt < isoTimestamp) {
        this.records.delete(token);
        removed += 1;
      }
    }
    return Promise.resolve(removed);
  }
}
