import type { ScanResult } from '@agentic-readiness/catalog';
import { describe, expect, it } from 'vitest';

import { FakeSqlDatabase } from '../store/fake-sql.js';
import type { StoredScan } from '../store/types.js';
import { MAX_TARGET_ROWS, SqlTargetRegistry } from './sql.js';
import { recordFromScan } from './types.js';

/** Only the fields the registry reads; the rest of the result is irrelevant here. */
function storedScan(overrides: Partial<StoredScan> = {}): StoredScan {
  const result = {
    target: {
      url: 'https://ceramics.example',
      platform: 'woocommerce',
      profile: 'woocommerce-store',
    },
    level: { value: 2 },
    scores: { ingestion: 80, commerce: 65 },
  } as unknown as ScanResult;
  return {
    id: 'abcdef0123456789',
    host: 'ceramics.example',
    createdAt: '2026-10-30T12:00:00.000Z',
    result,
    ...overrides,
  };
}

const ROW = {
  host: 'ceramics.example',
  url: 'https://ceramics.example',
  first_seen_at: '2026-10-01T00:00:00.000Z',
  last_seen_at: '2026-10-30T12:00:00.000Z',
  scan_count: 3,
  last_scan_id: 'abcdef0123456789',
  last_level: 2,
  last_ingestion: 80,
  last_commerce: null,
  last_platform: 'woocommerce',
  last_profile: 'woocommerce-store',
};

describe('recordFromScan', () => {
  it('starts a record from a scan and advances an existing one', () => {
    const first = recordFromScan(storedScan());
    expect(first).toMatchObject({
      host: 'ceramics.example',
      firstSeenAt: '2026-10-30T12:00:00.000Z',
      scanCount: 1,
      lastLevel: 2,
      lastCommerce: 65,
    });
    const second = recordFromScan(
      storedScan({ id: 'fedcba9876543210', createdAt: '2026-11-06T12:00:00.000Z' }),
      first,
    );
    expect(second).toMatchObject({
      firstSeenAt: '2026-10-30T12:00:00.000Z',
      lastSeenAt: '2026-11-06T12:00:00.000Z',
      scanCount: 2,
      lastScanId: 'fedcba9876543210',
    });
  });
});

describe('SqlTargetRegistry', () => {
  it('creates the table once and upserts one row per host', async () => {
    const db = new FakeSqlDatabase();
    const registry = new SqlTargetRegistry(db);
    await registry.record(storedScan());
    await registry.record(storedScan({ id: 'fedcba9876543210' }));
    expect(db.statements(/^CREATE TABLE IF NOT EXISTS targets/)).toHaveLength(1);
    const upserts = db.statements(/^INSERT INTO targets/);
    expect(upserts).toHaveLength(2);
    expect(upserts[0]?.sql).toContain('ON DUPLICATE KEY UPDATE');
    expect(upserts[0]?.sql).toContain('scan_count = scan_count + 1');
    expect(upserts[0]?.values).toEqual([
      'ceramics.example',
      'https://ceramics.example',
      '2026-10-30T12:00:00.000Z',
      '2026-10-30T12:00:00.000Z',
      'abcdef0123456789',
      2,
      80,
      65,
      'woocommerce',
      'woocommerce-store',
    ]);
  });

  it('lists newest first with a clamped integer LIMIT and maps rows to records', async () => {
    const db = new FakeSqlDatabase().script(/^SELECT \* FROM targets/, [ROW]);
    const registry = new SqlTargetRegistry(db);
    const records = await registry.list(2.7);
    expect(records).toEqual([
      {
        host: 'ceramics.example',
        url: 'https://ceramics.example',
        firstSeenAt: '2026-10-01T00:00:00.000Z',
        lastSeenAt: '2026-10-30T12:00:00.000Z',
        scanCount: 3,
        lastScanId: 'abcdef0123456789',
        lastLevel: 2,
        lastIngestion: 80,
        lastCommerce: null,
        lastPlatform: 'woocommerce',
        lastProfile: 'woocommerce-store',
      },
    ]);
    expect(db.statements(/^SELECT/)[0]?.sql).toContain('ORDER BY last_seen_at DESC LIMIT 2');
    await registry.list(1e9);
    expect(db.statements(/^SELECT/)[1]?.sql).toContain(`LIMIT ${MAX_TARGET_ROWS}`);
    await registry.list(Number.NaN);
    expect(db.statements(/^SELECT/)[2]?.sql).toContain('LIMIT 1');
  });

  it('rejects a malformed row with a clear error', async () => {
    const db = new FakeSqlDatabase().script(/^SELECT/, [{ ...ROW, scan_count: '3' }]);
    await expect(new SqlTargetRegistry(db).list(10)).rejects.toThrow(
      'malformed targets row: scan_count',
    );
  });
});
