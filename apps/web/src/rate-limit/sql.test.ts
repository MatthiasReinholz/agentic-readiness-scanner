import { describe, expect, it, vi } from 'vitest';

import { FakeSqlDatabase } from '../store/fake-sql.js';
import { SqlScanLimiter } from './sql.js';

/** Broker contract double, not a SQL engine. Models one atomic row mutation per upsert. */
function claimBroker() {
  const db = new FakeSqlDatabase();
  const rows = new Map<string, { next_at: string; claim_token: string }>();
  const execute = db.execute.bind(db);
  vi.spyOn(db, 'execute').mockImplementation((sql, values) => {
    const scripted = execute(sql, values);
    const host = String(values[0]);
    if (sql.startsWith('INSERT INTO scan_limits')) {
      const previous = rows.get(host);
      if (!previous || previous.next_at <= String(values[3]))
        rows.set(host, { next_at: String(values[1]), claim_token: String(values[2]) });
    }
    if (sql.startsWith('SELECT next_at')) {
      const row = rows.get(host);
      return { pattern: /./, rows: row ? [row] : [], changes: 0 };
    }
    return scripted;
  });
  return { db, rows };
}

describe('SQL scan reservations', () => {
  it('allows one claimant across independent instances and does not extend denied reservations', async () => {
    const { db, rows } = claimBroker();
    const a = new SqlScanLimiter(db);
    const b = new SqlScanLimiter(db);
    const time = new Date('2026-11-02T12:00:00Z');
    const outcomes = await Promise.all([
      a.acquire('shop.example', time, 60),
      b.acquire('shop.example', time, 60),
    ]);
    expect(outcomes.filter((outcome) => outcome.allowed)).toHaveLength(1);
    expect(outcomes.find((outcome) => !outcome.allowed)?.retryAfterSeconds).toBe(60);
    const reserved = rows.get('shop.example')?.next_at;
    expect(await b.acquire('shop.example', new Date(time.getTime() + 30_000), 60)).toEqual({
      allowed: false,
      retryAfterSeconds: 30,
    });
    expect(rows.get('shop.example')?.next_at).toBe(reserved);
    expect(await b.acquire('shop.example', new Date(time.getTime() + 60_000), 60)).toEqual({
      allowed: true,
      retryAfterSeconds: 0,
    });
    expect((await a.acquire('other.example', time, 60)).allowed).toBe(true);
    // The claim-token read, not ambiguous affected-row metadata, decides ownership.
    const insert = db.statements('INSERT INTO scan_limits')[0];
    expect(insert?.sql).toContain('ON DUPLICATE KEY UPDATE');
    expect(insert?.sql).toContain(
      'claim_token = IF(next_at <= ?, VALUES(claim_token), claim_token)',
    );
    expect(insert?.sql.indexOf('claim_token = IF')).toBeLessThan(
      insert?.sql.indexOf('next_at = IF') ?? 0,
    );
    expect(insert?.values).toEqual([
      'shop.example',
      '2026-11-02T12:01:00.000Z',
      expect.stringMatching(/^[0-9a-f]{32}$/),
      '2026-11-02T12:00:00.000Z',
      '2026-11-02T12:00:00.000Z',
    ]);
  });

  it('never permits a shorter interval and fails closed when the claim cannot be read', async () => {
    const { db, rows } = claimBroker();
    const limiter = new SqlScanLimiter(db);
    await limiter.acquire('shop.example', new Date('2026-11-02T12:00:00Z'), 1);
    expect(rows.get('shop.example')?.next_at).toBe('2026-11-02T12:01:00.000Z');
    await expect(
      new SqlScanLimiter(new FakeSqlDatabase()).acquire('shop.example', new Date(), 60),
    ).rejects.toThrow('Scan reservation missing');
    const malformed = new FakeSqlDatabase().script('SELECT next_at', [
      { claim_token: 'not-mine', next_at: 'invalid' },
    ]);
    await expect(
      new SqlScanLimiter(malformed).acquire('shop.example', new Date(), 60),
    ).rejects.toThrow('Invalid scan reservation time');
  });
});
