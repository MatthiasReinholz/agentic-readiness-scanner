import type { StoredScan } from '../store/types.js';
import {
  confirmedEntry,
  confirmsEntry,
  entryFromScan,
  type HistoryEntry,
  type HistoryStore,
} from './types.js';

export class MemoryHistoryStore implements HistoryStore {
  private readonly entries = new Map<string, HistoryEntry[]>();

  record(scan: StoredScan): Promise<void> {
    const list = this.entries.get(scan.host) ?? [];
    const latest = list[0];
    if (latest && confirmsEntry(latest, scan)) list[0] = confirmedEntry(latest, scan);
    else list.unshift(entryFromScan(scan));
    this.entries.set(scan.host, list);
    return Promise.resolve();
  }

  forHost(host: string, limit: number): Promise<HistoryEntry[]> {
    return Promise.resolve(structuredClone((this.entries.get(host) ?? []).slice(0, limit)));
  }
}
