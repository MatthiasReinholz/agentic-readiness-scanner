import { diffSnapshots, snapshotOf } from '@agentic-readiness/core';

import type { AppConfig } from '../config.js';
import type { StoredScan } from '../store/types.js';
import { changeEmail, confirmEmail } from './emails.js';
import { digestsEqual, hashToken, newMonitorId, newToken } from './tokens.js';
import type { Baseline, Mailer, Monitor, MonitorStore } from './types.js';

export interface MonitoringDependencies {
  config: AppConfig;
  store: MonitorStore;
  mailer: Mailer;
  /** Latest stored scan for a host, used as the baseline when a subscription is confirmed. */
  latestScan: (host: string) => Promise<StoredScan | null>;
  /** Runs (or reuses) a scan of a URL; the weekly check calls it once per host. */
  rescan: (url: string) => Promise<StoredScan>;
  now?: () => Date;
}

export type SubscribeOutcome = 'confirmation_sent' | 'already_active' | 'throttled';

/** Confirmation emails one address can be sent per day, across all hosts. */
export const CONFIRMATIONS_PER_ADDRESS_PER_DAY = 5;
/** Unconfirmed requests are forgotten after this long, as the confirmation email promises. */
export const PENDING_TTL_MS = 48 * 60 * 60 * 1000;

export interface RunReport {
  due: number;
  checked: number;
  notified: number;
  failed: number;
}

/** Re-sending a confirmation is limited to once per address and host per this window. */
const CONFIRM_RESEND_MS = 60 * 60 * 1000;

function baselineOf(scan: StoredScan): Baseline {
  return { ...snapshotOf(scan.result), scannedAt: scan.result.scanned_at, scanId: scan.id };
}

/**
 * Double opt-in monitoring of one host per subscriber. Nothing is emailed until the
 * address confirms; after that, a rescan every `intervalDays` and an email only when
 * the comparison with the last reported scan shows a change.
 */
export class MonitoringService {
  private readonly now: () => Date;

  constructor(private readonly deps: MonitoringDependencies) {
    this.now = deps.now ?? (() => new Date());
  }

  private link(path: string): string {
    return `${this.deps.config.baseUrl}${path}`;
  }

  async subscribe(email: string, scan: StoredScan): Promise<SubscribeOutcome> {
    const existing = await this.deps.store.findByEmailAndHost(email, scan.host);
    if (existing?.status === 'active') return 'already_active';
    const nowIso = this.now().toISOString();
    if (
      existing?.status === 'pending' &&
      this.now().getTime() - Date.parse(existing.createdAt) < CONFIRM_RESEND_MS
    ) {
      return 'throttled';
    }
    const dayAgo = new Date(this.now().getTime() - 86_400_000).toISOString();
    if (
      (await this.deps.store.countCreatedSince(email, dayAgo)) >= CONFIRMATIONS_PER_ADDRESS_PER_DAY
    ) {
      return 'throttled';
    }
    const confirmToken = newToken();
    const manageToken = newToken();
    const monitor: Monitor = {
      id: existing?.id ?? newMonitorId(),
      email,
      host: scan.host,
      url: scan.result.target.url,
      status: 'pending',
      confirmTokenHash: await hashToken(confirmToken),
      manageTokenHash: await hashToken(manageToken),
      createdAt: nowIso,
      confirmedAt: null,
      unsubscribedAt: null,
      lastCheckedAt: null,
      lastNotifiedAt: null,
      baseline: null,
    };
    if (existing) await this.deps.store.update(monitor);
    else await this.deps.store.create(monitor);
    await this.deps.mailer.send(
      confirmEmail(this.deps.config, {
        to: email,
        host: scan.host,
        confirmUrl: this.link(`/monitor/confirm/${monitor.id}/${confirmToken}`),
      }),
    );
    return 'confirmation_sent';
  }

  /** Activates a pending subscription and returns it; null when the id or token is wrong or it was unsubscribed. */
  async confirm(id: string, token: string): Promise<Monitor | null> {
    const monitor = await this.deps.store.get(id);
    if (!monitor || monitor.status === 'unsubscribed') return null;
    if (!digestsEqual(monitor.confirmTokenHash, await hashToken(token))) return null;
    if (monitor.status === 'active') return monitor;
    const latest = await this.deps.latestScan(monitor.host);
    const nowIso = this.now().toISOString();
    const active: Monitor = {
      ...monitor,
      status: 'active',
      confirmedAt: nowIso,
      lastCheckedAt: nowIso,
      baseline: latest ? baselineOf(latest) : null,
    };
    await this.deps.store.update(active);
    return active;
  }

  async unsubscribe(id: string, token: string): Promise<Monitor | null> {
    const monitor = await this.deps.store.get(id);
    if (!monitor) return null;
    if (!digestsEqual(monitor.manageTokenHash, await hashToken(token))) return null;
    if (monitor.status === 'unsubscribed') return monitor;
    const stopped: Monitor = {
      ...monitor,
      status: 'unsubscribed',
      unsubscribedAt: this.now().toISOString(),
    };
    await this.deps.store.update(stopped);
    return stopped;
  }

  /** Forgets unconfirmed requests older than PENDING_TTL_MS. Called from the cleanup cron. */
  purgePending(): Promise<number> {
    const before = new Date(this.now().getTime() - PENDING_TTL_MS).toISOString();
    return this.deps.store.deletePendingOlderThan(before);
  }

  /** The unsubscribe link needs the raw manage token, which only exists at signup; mint a fresh one. */
  private async rotateManageToken(monitor: Monitor): Promise<{ monitor: Monitor; token: string }> {
    const token = newToken();
    const updated: Monitor = { ...monitor, manageTokenHash: await hashToken(token) };
    return { monitor: updated, token };
  }

  /**
   * Checks every due subscription: one scan per host, one comparison per subscriber,
   * one email per change. A failed scan counts as checked so it is retried next
   * interval, not every run.
   */
  async runDue(): Promise<RunReport> {
    const { intervalDays, batchSize } = this.deps.config.monitoring;
    const before = new Date(this.now().getTime() - intervalDays * 86_400_000).toISOString();
    const due = await this.deps.store.listDue(before, batchSize);
    const scansByHost = new Map<string, Promise<StoredScan>>();
    const report: RunReport = { due: due.length, checked: 0, notified: 0, failed: 0 };
    for (const monitor of due) {
      const nowIso = this.now().toISOString();
      // Claim the row first: an overlapping run then sees it as not due, and a failure
      // below still leaves it scheduled for the next interval rather than the next run.
      let next: Monitor = { ...monitor, lastCheckedAt: nowIso };
      await this.deps.store.update(next);
      try {
        let pending = scansByHost.get(monitor.host);
        if (!pending) {
          pending = this.deps.rescan(monitor.url);
          scansByHost.set(monitor.host, pending);
        }
        const scan = await pending;
        report.checked += 1;
        const current = baselineOf(scan);
        const diff = monitor.baseline ? diffSnapshots(monitor.baseline, current) : null;
        next = { ...next, baseline: current };
        if (diff?.changed) {
          const rotated = await this.rotateManageToken(next);
          await this.deps.mailer.send(
            changeEmail(this.deps.config, {
              to: monitor.email,
              host: monitor.host,
              diff,
              reportUrl: this.link(`/r/${scan.id}`),
              unsubscribeUrl: this.link(`/monitor/unsubscribe/${monitor.id}/${rotated.token}`),
              level: scan.result.level,
            }),
          );
          next = { ...rotated.monitor, lastNotifiedAt: nowIso };
          report.notified += 1;
        }
        await this.deps.store.update(next);
      } catch (error) {
        // A failed rescan or a mail provider error affects this subscriber only; the
        // baseline is kept so the change is reported on the next successful run.
        report.failed += 1;
        console.warn(`[monitor] ${monitor.host} for ${monitor.id}: ${String(error)}`);
      }
    }
    return report;
  }
}
