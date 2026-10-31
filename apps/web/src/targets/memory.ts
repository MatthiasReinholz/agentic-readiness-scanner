import type { StoredScan } from '../store/types.js';
import { recordFromScan, type TargetRecord, type TargetRegistry } from './types.js';

export class MemoryTargetRegistry implements TargetRegistry {
  private readonly targets = new Map<string, TargetRecord>();

  record(scan: StoredScan): Promise<void> {
    this.targets.set(scan.host, recordFromScan(scan, this.targets.get(scan.host)));
    return Promise.resolve();
  }

  list(limit: number): Promise<TargetRecord[]> {
    const all = [...this.targets.values()]
      .sort((a, b) => b.lastSeenAt.localeCompare(a.lastSeenAt))
      .slice(0, limit);
    return Promise.resolve(structuredClone(all));
  }
}
