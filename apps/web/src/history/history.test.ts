import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import type { ScanResult } from '@agentic-readiness/catalog';
import { scan } from '@agentic-readiness/core';
import { fixtureFetcher } from '@agentic-readiness/core/testing';
import { describe, expect, it } from 'vitest';

import { FakeSqlDatabase } from '../store/fake-sql.js';
import type { StoredScan } from '../store/types.js';
import { MemoryHistoryStore } from './memory.js';
import { SqlHistoryStore } from './sql.js';
import { confirmsEntry, entryContaining, entryFromScan } from './types.js';

const fixture = join(
  dirname(fileURLToPath(import.meta.url)),
  '..',
  '..',
  '..',
  '..',
  'fixtures',
  'stores',
  'good-woocommerce',
);

let cached: ScanResult | null = null;
async function result(): Promise<ScanResult> {
  cached ??= await scan('https://ceramics.example/', {
    fetcher: fixtureFetcher(fixture),
    now: () => new Date('2026-10-30T12:00:00Z'),
  });
  return cached;
}

async function stored(id: string, createdAt: string, mutate?: (r: ScanResult) => ScanResult) {
  const base = await result();
  const copy = structuredClone(base);
  return {
    id,
    host: 'ceramics.example',
    createdAt,
    result: mutate ? mutate(copy) : copy,
  } satisfies StoredScan;
}

/** The same scan with one verdict flipped, as a site change would produce. */
function flipFirstPass(r: ScanResult): ScanResult {
  const item = r.results.find((entry) => entry.verdict === 'pass');
  if (!item) throw new Error('no passing check in fixture');
  item.verdict = 'fail';
  return r;
}

describe('history entries', () => {
  it('builds an entry from a scan and recognises a confirming rescan', async () => {
    const first = await stored('a000000000000001', '2026-10-01T00:00:00.000Z');
    const entry = entryFromScan(first);
    expect(entry.scans).toBe(1);
    expect(entry.snapshot.verdicts['A1.1']).toBe('pass');
    expect(entry.snapshot.groups?.A1).toBe(first.result.scores.groups.A1);
    expect(Object.keys(entry.snapshot.skips ?? {}).length).toBeGreaterThan(0);
    const same = await stored('a000000000000002', '2026-10-08T00:00:00.000Z');
    expect(confirmsEntry(entry, same)).toBe(true);
    const changed = await stored('a000000000000003', '2026-10-15T00:00:00.000Z', flipFirstPass);
    expect(confirmsEntry(entry, changed)).toBe(false);
    const otherCatalog = await stored('a000000000000004', '2026-10-15T00:00:00.000Z', (r) => ({
      ...r,
      catalog_version: '99.0.0',
    }));
    expect(confirmsEntry(entry, otherCatalog)).toBe(false);
  });

  it('finds the entry that holds a scan by id or by period', async () => {
    const entries = [
      {
        ...entryFromScan(await stored('b000000000000002', '2026-10-15T00:00:00.000Z')),
      },
      {
        ...entryFromScan(await stored('b000000000000001', '2026-10-01T00:00:00.000Z')),
        lastAt: '2026-10-08T00:00:00.000Z',
        lastScanId: 'b000000000000009',
        scans: 2,
      },
    ];
    expect(entryContaining(entries, { id: 'b000000000000009', createdAt: 'x' })?.id).toBe(
      'b000000000000001',
    );
    expect(
      entryContaining(entries, { id: 'unknown', createdAt: '2026-10-04T00:00:00.000Z' })?.id,
    ).toBe('b000000000000001');
    expect(entryContaining(entries, { id: 'unknown', createdAt: '2026-09-01T00:00:00.000Z' })).toBe(
      null,
    );
  });
});

describe('MemoryHistoryStore', () => {
  it('extends the current entry on an unchanged rescan and opens a new one on change', async () => {
    const store = new MemoryHistoryStore();
    await store.record(await stored('c000000000000001', '2026-10-01T00:00:00.000Z'));
    await store.record(await stored('c000000000000002', '2026-10-08T00:00:00.000Z'));
    let entries = await store.forHost('ceramics.example', 10);
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({
      id: 'c000000000000001',
      lastScanId: 'c000000000000002',
      scans: 2,
      firstAt: '2026-10-01T00:00:00.000Z',
      lastAt: '2026-10-08T00:00:00.000Z',
    });
    await store.record(await stored('c000000000000003', '2026-10-15T00:00:00.000Z', flipFirstPass));
    entries = await store.forHost('ceramics.example', 10);
    expect(entries.map((entry) => entry.id)).toEqual(['c000000000000003', 'c000000000000001']);
    expect(await store.forHost('other.example', 10)).toEqual([]);
  });
});

describe('SqlHistoryStore', () => {
  it('inserts a row for a new state with the snapshot as JSON columns', async () => {
    const db = new FakeSqlDatabase();
    const store = new SqlHistoryStore(db);
    const first = await stored('d000000000000001', '2026-10-01T00:00:00.000Z');
    await store.record(first);
    expect(db.statements(/^CREATE TABLE IF NOT EXISTS scan_history/)).toHaveLength(1);
    const insert = db.statements(/^INSERT INTO scan_history/)[0];
    expect(insert?.values.slice(0, 7)).toEqual([
      'd000000000000001',
      'ceramics.example',
      'https://ceramics.example',
      '2026-10-01T00:00:00.000Z',
      '2026-10-01T00:00:00.000Z',
      1,
      'd000000000000001',
    ]);
    expect(insert?.values[12]).toBe(first.result.level.value);
    const verdicts = JSON.parse(String(insert?.values[16])) as Record<string, string>;
    expect(verdicts['A1.1']).toBe('pass');
  });

  it('updates the newest row when the rescan confirms it', async () => {
    const db = new FakeSqlDatabase();
    const first = await stored('e000000000000001', '2026-10-01T00:00:00.000Z');
    const entry = entryFromScan(first);
    db.script(/FROM scan_history WHERE host = \?/, [
      {
        id: entry.id,
        host: entry.host,
        url: entry.url,
        first_at: entry.firstAt,
        last_at: entry.lastAt,
        scans: 1,
        last_scan_id: entry.lastScanId,
        catalog_version: entry.catalogVersion,
        scoring_version: entry.scoringVersion,
        scanner_version: entry.scannerVersion,
        platform: entry.platform,
        profile: entry.profile,
        level: entry.snapshot.level,
        ingestion: entry.snapshot.ingestion,
        commerce: entry.snapshot.commerce,
        groups_json: JSON.stringify(entry.snapshot.groups),
        verdicts_json: JSON.stringify(entry.snapshot.verdicts),
        skips_json: JSON.stringify(entry.snapshot.skips),
      },
    ]);
    const store = new SqlHistoryStore(db);
    await store.record(await stored('e000000000000002', '2026-10-08T00:00:00.000Z'));
    expect(db.statements(/^INSERT INTO scan_history/)).toHaveLength(0);
    const update = db.statements(/^UPDATE scan_history/)[0];
    expect(update?.values).toEqual([
      'https://ceramics.example',
      '2026-10-08T00:00:00.000Z',
      2,
      'e000000000000002',
      entry.scannerVersion,
      'e000000000000001',
    ]);
    const [read] = await store.forHost('ceramics.example', 5);
    expect(read?.snapshot.verdicts).toEqual(entry.snapshot.verdicts);
    expect(db.statements(/FROM scan_history WHERE host/)[1]?.sql).toContain(
      'ORDER BY last_at DESC LIMIT 5',
    );
  });
});
