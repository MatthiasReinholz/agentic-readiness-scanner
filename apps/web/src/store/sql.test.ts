import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import type { ScanResult } from '@agentic-readiness/catalog';
import { computeScores, scan } from '@agentic-readiness/core';
import { fixtureFetcher } from '@agentic-readiness/core/testing';
import { describe, expect, it } from 'vitest';

import { FakeSqlDatabase } from './fake-sql.js';
import { clampLimit, RowReader } from './sql-store.js';
import { SqlResultStore, stripFixes } from './sql.js';
import type { StoredScan } from './types.js';

const contentSite = join(
  dirname(fileURLToPath(import.meta.url)),
  '..',
  '..',
  '..',
  '..',
  'fixtures',
  'stores',
  'content-site',
);

let cachedResult: ScanResult | null = null;
async function sampleScan(): Promise<StoredScan> {
  cachedResult ??= await scan('https://blog.example/', {
    fetcher: fixtureFetcher(contentSite),
    now: () => new Date('2026-10-30T12:00:00Z'),
  });
  return {
    id: 'abcdef0123456789',
    host: 'blog.example',
    createdAt: '2026-10-30T12:00:00.000Z',
    result: cachedResult,
  };
}

function insertedJson(db: FakeSqlDatabase): string {
  const insert = db.statements(/^INSERT INTO scans/)[0];
  const json = insert?.values[6];
  if (typeof json !== 'string') throw new Error('no INSERT recorded');
  return json;
}

describe('SqlResultStore', () => {
  it('issues the DDL once per store, before the first statement', async () => {
    const db = new FakeSqlDatabase();
    const store = new SqlResultStore(db);
    const stored = await sampleScan();
    await store.put(stored);
    await store.get(stored.id);
    await store.latestForHost(stored.host);
    expect(db.statements(/^CREATE TABLE IF NOT EXISTS scans/)).toHaveLength(1);
    expect(db.executed[0]?.sql).toMatch(/^CREATE TABLE/);
  });

  it('stores a result without fixes plus the summary columns and reads it back with fixes', async () => {
    const db = new FakeSqlDatabase();
    const store = new SqlResultStore(db);
    const stored = await sampleScan();
    await store.put(stored);
    const insert = db.statements(/^INSERT INTO scans/)[0];
    expect(insert?.values.slice(0, 6)).toEqual([
      stored.id,
      stored.host,
      stored.createdAt,
      stored.result.level.value,
      stored.result.scores.ingestion,
      stored.result.scores.commerce,
    ]);
    const json = insertedJson(db);
    expect(json).toBe(JSON.stringify(stripFixes(stored.result)));
    expect(stored.result.results.some((item) => item.fix !== undefined)).toBe(true);
    expect(json).not.toContain('"fix"');

    db.script(/SELECT .* FROM scans WHERE id = \?/, [
      { id: stored.id, host: stored.host, created_at: stored.createdAt, result: json },
    ]);
    const read = await store.get(stored.id);
    expect(read).toEqual(stored);
    expect(db.statements(/WHERE id = \?/)[0]?.values).toEqual([stored.id]);
  });

  it('backfills scores.groups for rows stored before it existed', async () => {
    const db = new FakeSqlDatabase();
    const stored = await sampleScan();
    const { ingestion, commerce } = stored.result.scores;
    const legacy = JSON.stringify({
      ...stripFixes(stored.result),
      scores: { ingestion, commerce },
    });
    db.script(/FROM scans WHERE host = \?/, [
      { id: stored.id, host: stored.host, created_at: stored.createdAt, result: legacy },
    ]);
    const read = await new SqlResultStore(db).latestForHost(stored.host);
    expect(read?.result.scores).toEqual(computeScores(stored.result.results));
  });

  it('asks for the newest row per host and returns null when there is none', async () => {
    const db = new FakeSqlDatabase();
    const store = new SqlResultStore(db);
    expect(await store.latestForHost('blog.example')).toBeNull();
    const query = db.statements(/FROM scans WHERE host = \?/)[0];
    expect(query?.sql).toContain('ORDER BY created_at DESC LIMIT 1');
    expect(query?.values).toEqual(['blog.example']);
    expect(await store.get('0000000000000000')).toBeNull();
  });

  it('reports deleted rows from meta.changes, or zero when the broker omits it', async () => {
    const db = new FakeSqlDatabase().script(/^DELETE FROM scans/, [], 3);
    const store = new SqlResultStore(db);
    expect(await store.deleteOlderThan('2026-10-01T00:00:00.000Z')).toBe(3);
    expect(db.statements(/^DELETE FROM scans/)[0]?.values).toEqual(['2026-10-01T00:00:00.000Z']);
    expect(await new SqlResultStore(new FakeSqlDatabase()).deleteOlderThan('x')).toBe(0);
  });

  it('rejects a malformed row with a clear error', async () => {
    const db = new FakeSqlDatabase().script(/FROM scans WHERE id/, [
      { id: 'abcdef0123456789', host: 'h', created_at: 'c', result: 42 },
    ]);
    await expect(new SqlResultStore(db).get('x')).rejects.toThrow('malformed scans row: result');
  });
});

describe('row helpers', () => {
  it('reads typed columns and names the offending one', () => {
    const reader = new RowReader('t', { a: 'x', b: 2, c: null });
    expect(reader.string('a')).toBe('x');
    expect(reader.number('b')).toBe(2);
    expect(reader.nullableString('c')).toBeNull();
    expect(reader.nullableNumber('c')).toBeNull();
    expect(reader.nullableString('missing')).toBeNull();
    expect(() => reader.string('b')).toThrow('malformed t row: b');
    expect(() => reader.number('a')).toThrow('malformed t row: a');
    expect(() => reader.nullableNumber('a')).toThrow('malformed t row: a');
  });

  it('clamps limits to a positive integer within the cap', () => {
    expect(clampLimit(2.9, 100)).toBe(2);
    expect(clampLimit(0, 100)).toBe(1);
    expect(clampLimit(-5, 100)).toBe(1);
    expect(clampLimit(Number.NaN, 100)).toBe(1);
    expect(clampLimit(Number.POSITIVE_INFINITY, 100)).toBe(1);
    expect(clampLimit(1e9, 100)).toBe(100);
  });
});
