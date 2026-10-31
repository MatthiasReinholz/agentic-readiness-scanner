import { describe, expect, it } from 'vitest';

import { FakeSqlDatabase } from '../store/fake-sql.js';
import { MAX_MONITOR_ROWS, SqlMonitorStore } from './sql.js';
import type { Baseline, Monitor } from './types.js';

const baseline: Baseline = {
  level: 2,
  ingestion: 80,
  commerce: 65,
  verdicts: { 'A1.1': 'pass' },
  scannedAt: '2026-10-30T12:00:00.000Z',
  scanId: 'abcdef0123456789',
};

const monitor: Monitor = {
  id: '0123456789abcdef',
  email: 'owner@example.com',
  host: 'ceramics.example',
  url: 'https://ceramics.example',
  status: 'active',
  confirmTokenHash: 'a'.repeat(64),
  manageTokenHash: 'b'.repeat(64),
  createdAt: '2026-10-30T12:00:00.000Z',
  confirmedAt: '2026-10-30T12:05:00.000Z',
  unsubscribedAt: null,
  lastCheckedAt: null,
  lastNotifiedAt: null,
  baseline,
};

/** The row the broker would return for `monitor`. */
const row = {
  id: monitor.id,
  email: monitor.email,
  host: monitor.host,
  url: monitor.url,
  status: monitor.status,
  confirm_token_hash: monitor.confirmTokenHash,
  manage_token_hash: monitor.manageTokenHash,
  created_at: monitor.createdAt,
  confirmed_at: monitor.confirmedAt,
  unsubscribed_at: null,
  last_checked_at: null,
  last_notified_at: null,
  baseline: JSON.stringify(baseline),
};

describe('SqlMonitorStore', () => {
  it('creates the table once and inserts every column, with the baseline as JSON', async () => {
    const db = new FakeSqlDatabase();
    const store = new SqlMonitorStore(db);
    await store.create(monitor);
    await store.create({ ...monitor, id: 'fedcba9876543210', baseline: null });
    expect(db.statements(/^CREATE TABLE IF NOT EXISTS monitors/)).toHaveLength(1);
    const inserts = db.statements(/^INSERT INTO monitors/);
    expect(inserts[0]?.values).toEqual([
      monitor.id,
      monitor.email,
      monitor.host,
      monitor.url,
      'active',
      monitor.confirmTokenHash,
      monitor.manageTokenHash,
      monitor.createdAt,
      monitor.confirmedAt,
      null,
      null,
      null,
      JSON.stringify(baseline),
    ]);
    expect(inserts[1]?.values[12]).toBeNull();
  });

  it('updates by id with the id bound last', async () => {
    const db = new FakeSqlDatabase();
    await new SqlMonitorStore(db).update({ ...monitor, status: 'unsubscribed' });
    const update = db.statements(/^UPDATE monitors SET/)[0];
    expect(update?.sql).toMatch(/WHERE id = \?$/);
    expect(update?.values).toHaveLength(12);
    expect(update?.values[3]).toBe('unsubscribed');
    expect(update?.values[11]).toBe(monitor.id);
  });

  it('reads a monitor back by id or by email and host, parsing the baseline', async () => {
    const db = new FakeSqlDatabase()
      .script(/FROM monitors WHERE id = \?/, [row])
      .script(/WHERE email = \? AND host = \?/, [row]);
    const store = new SqlMonitorStore(db);
    expect(await store.get(monitor.id)).toEqual(monitor);
    expect(await store.findByEmailAndHost(monitor.email, monitor.host)).toEqual(monitor);
    expect(db.statements(/WHERE email = \? AND host = \?/)[0]?.values).toEqual([
      monitor.email,
      monitor.host,
    ]);
    expect(await new SqlMonitorStore(new FakeSqlDatabase()).get('missing')).toBeNull();
  });

  it('lists due monitors, active and unchecked first, with a clamped LIMIT', async () => {
    const db = new FakeSqlDatabase().script(/WHERE status = 'active'/, [row]);
    const store = new SqlMonitorStore(db);
    const due = await store.listDue('2026-10-23T12:00:00.000Z', 10.9);
    expect(due).toEqual([monitor]);
    const query = db.statements(/WHERE status = 'active'/)[0];
    expect(query?.sql).toContain('last_checked_at IS NULL OR last_checked_at < ?');
    expect(query?.sql).toContain(
      'ORDER BY last_checked_at IS NULL DESC, last_checked_at ASC LIMIT 10',
    );
    expect(query?.values).toEqual(['2026-10-23T12:00:00.000Z']);
    await store.listDue('x', 1e9);
    expect(db.statements(/WHERE status = 'active'/)[1]?.sql).toContain(`LIMIT ${MAX_MONITOR_ROWS}`);
  });

  it('lists everything newest first for the export', async () => {
    const db = new FakeSqlDatabase().script(/ORDER BY created_at DESC/, [
      row,
      { ...row, id: 'fedcba9876543210' },
    ]);
    const all = await new SqlMonitorStore(db).list(0);
    expect(all.map((item) => item.id)).toEqual([monitor.id, 'fedcba9876543210']);
    expect(db.statements(/ORDER BY created_at DESC/)[0]?.sql).toMatch(/LIMIT 1$/);
  });

  it('counts recent confirmations whatever type the broker uses for COUNT(*)', async () => {
    const asString = new FakeSqlDatabase().script(/SELECT COUNT\(\*\) AS n/, [{ n: '3' }]);
    expect(
      await new SqlMonitorStore(asString).countCreatedSince('owner@example.com', 'since'),
    ).toBe(3);
    expect(asString.statements(/COUNT/)[0]?.values).toEqual(['owner@example.com', 'since']);
    const asNumber = new FakeSqlDatabase().script(/SELECT COUNT\(\*\) AS n/, [{ n: 2 }]);
    expect(await new SqlMonitorStore(asNumber).countCreatedSince('a', 'b')).toBe(2);
    expect(await new SqlMonitorStore(new FakeSqlDatabase()).countCreatedSince('a', 'b')).toBe(0);
  });

  it('deletes stale pending rows and reports meta.changes', async () => {
    const db = new FakeSqlDatabase().script(
      /^DELETE FROM monitors WHERE status = 'pending'/,
      [],
      4,
    );
    expect(await new SqlMonitorStore(db).deletePendingOlderThan('before')).toBe(4);
    expect(db.statements(/^DELETE/)[0]?.values).toEqual(['before']);
  });

  it('rejects rows with an unknown status or a missing column', async () => {
    const badStatus = new FakeSqlDatabase().script(/WHERE id/, [{ ...row, status: 'paused' }]);
    await expect(new SqlMonitorStore(badStatus).get('x')).rejects.toThrow(
      'malformed monitors row: status',
    );
    const missing = new FakeSqlDatabase().script(/WHERE id/, [{ ...row, email: undefined }]);
    await expect(new SqlMonitorStore(missing).get('x')).rejects.toThrow(
      'malformed monitors row: email',
    );
  });
});
