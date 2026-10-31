import type { Monitor, MonitorStore } from './types.js';

export class MemoryMonitorStore implements MonitorStore {
  private readonly monitors = new Map<string, Monitor>();

  create(monitor: Monitor): Promise<void> {
    this.monitors.set(monitor.id, structuredClone(monitor));
    return Promise.resolve();
  }

  update(monitor: Monitor): Promise<void> {
    this.monitors.set(monitor.id, structuredClone(monitor));
    return Promise.resolve();
  }

  get(id: string): Promise<Monitor | null> {
    const found = this.monitors.get(id);
    return Promise.resolve(found ? structuredClone(found) : null);
  }

  findByEmailAndHost(email: string, host: string): Promise<Monitor | null> {
    for (const monitor of this.monitors.values()) {
      if (monitor.email === email && monitor.host === host) {
        return Promise.resolve(structuredClone(monitor));
      }
    }
    return Promise.resolve(null);
  }

  listDue(before: string, limit: number): Promise<Monitor[]> {
    const due = [...this.monitors.values()]
      .filter(
        (monitor) =>
          monitor.status === 'active' &&
          (monitor.lastCheckedAt === null || monitor.lastCheckedAt < before),
      )
      .sort((a, b) => (a.lastCheckedAt ?? '').localeCompare(b.lastCheckedAt ?? ''))
      .slice(0, limit);
    return Promise.resolve(structuredClone(due));
  }

  list(limit: number): Promise<Monitor[]> {
    const all = [...this.monitors.values()]
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .slice(0, limit);
    return Promise.resolve(structuredClone(all));
  }
}
