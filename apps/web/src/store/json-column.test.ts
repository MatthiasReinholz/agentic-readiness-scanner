import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import type { ScanResult } from '@agentic-readiness/catalog';
import { scan, type ScanState } from '@agentic-readiness/core';
import { fixtureFetcher } from '@agentic-readiness/core/testing';
import { describe, expect, it } from 'vitest';

import { SqlScanJobStore } from '../jobs/sql.js';
import type { ScanJob } from '../jobs/types.js';
import { SqlProgressStore } from '../progress/sql.js';
import { FakeSqlDatabase } from './fake-sql.js';
import {
  JSON_COLUMN_BUDGET,
  JsonColumnTooLargeError,
  decodeJsonColumn,
  encodeJsonColumn,
  fitJsonColumn,
} from './json-column.js';
import { MAX_OPERATION_BYTES } from './sql-store.js';
import { SqlResultStore, stripFixes } from './sql.js';

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

let base: ScanResult | null = null;
async function baseResult(): Promise<ScanResult> {
  base ??= await scan('https://blog.example/', {
    fetcher: fixtureFetcher(contentSite),
    now: () => new Date('2026-10-30T12:00:00Z'),
  });
  return base;
}

/**
 * A result with evidence like a real store's: every check lists pages and headers it saw.
 * Plain JSON well over the 64 KiB a database operation may carry, as reynborg.de's was.
 */
async function richResult(): Promise<ScanResult> {
  const result = await baseResult();
  return {
    ...result,
    results: result.results.map((item, index) => ({
      ...item,
      evidence: {
        ...item.evidence,
        pages: Array.from(
          { length: 12 },
          (_, page) => `https://blog.example/shop/category-${index}/product-${page}/?variant=blue`,
        ),
        headers: { 'content-type': 'text/html; charset=UTF-8', 'x-powered-by': 'WordPress' },
      },
    })),
  };
}

function randomText(length: number): string {
  const bytes = new Uint8Array(length / 2);
  // getRandomValues fills at most 64 KiB per call.
  for (let at = 0; at < bytes.length; at += 65_536)
    crypto.getRandomValues(bytes.subarray(at, at + 65_536));
  return [...bytes].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

/** A result whose evidence does not compress: random text no packing makes small. */
async function incompressibleResult(): Promise<ScanResult> {
  const result = await baseResult();
  return {
    ...result,
    results: result.results.map((item, index) =>
      index < 4 ? { ...item, evidence: { ...item.evidence, blob: randomText(40_000) } } : item,
    ),
  };
}

/** A fake broker that refuses what Spacefast refuses and answers SELECTs from the last write. */
function limitedDatabase() {
  return new FakeSqlDatabase({ maxOperationBytes: MAX_OPERATION_BYTES });
}

describe('JSON columns', () => {
  it('pack values behind a prefix and read packed and plain JSON alike', async () => {
    const value = { verdict: 'pass', list: [1, 2, 3], text: 'ünïcødé' };
    const packed = await encodeJsonColumn(value);
    expect(packed.startsWith('gz:')).toBe(true);
    expect(await decodeJsonColumn(packed)).toEqual(value);
    expect(await decodeJsonColumn(JSON.stringify(value))).toEqual(value);
  });

  it('refuse a value that does not fit and cannot shrink, before any statement is sent', async () => {
    await expect(fitJsonColumn('test.column', { blob: randomText(200_000) })).rejects.toThrow(
      JsonColumnTooLargeError,
    );
  });
});

describe('a scan with a lot of evidence', () => {
  it('is stored in one operation the broker accepts and reads back unchanged', async () => {
    const result = await richResult();
    expect(JSON.stringify(stripFixes(result)).length).toBeGreaterThan(MAX_OPERATION_BYTES);
    const db = limitedDatabase();
    const store = new SqlResultStore(db);
    const stored = { id: 'abcdef0123456789', host: 'blog.example', createdAt: 'x', result };
    await store.put(stored);
    const insert = db.statements(/^INSERT INTO scans/)[0];
    expect(insert?.bytes).toBeLessThanOrEqual(MAX_OPERATION_BYTES);
    db.script(/FROM scans WHERE id = \?/, [
      { id: stored.id, host: stored.host, created_at: 'x', result: insert?.values[6] },
    ]);
    expect((await store.get(stored.id))?.result.results).toEqual(result.results);
  });

  it('drops the largest evidence it cannot pack small enough, keeping every verdict', async () => {
    const result = await incompressibleResult();
    const db = limitedDatabase();
    await new SqlResultStore(db).put({ id: 'abcdef0123456789', host: 'h', createdAt: 'x', result });
    const insert = db.statements(/^INSERT INTO scans/)[0];
    expect(insert?.bytes).toBeLessThanOrEqual(MAX_OPERATION_BYTES);
    const written = (await decodeJsonColumn(String(insert?.values[6]))) as ScanResult;
    expect(written.results.map((item) => [item.id, item.verdict, item.message])).toEqual(
      result.results.map((item) => [item.id, item.verdict, item.message]),
    );
    const omitted = written.results.filter((item) => typeof item.evidence.omitted === 'string');
    expect(omitted.length).toBeGreaterThan(0);
    expect(omitted.length).toBeLessThanOrEqual(4);
    expect(String(omitted[0]?.evidence.omitted)).toMatch(/too large to store \(\d+ characters\)/);
  });

  it('keeps its state between steps and its one-time result within one operation', async () => {
    const result = await richResult();
    const state = {
      format: 'agentic-readiness-scan-state/1',
      outcomes: Object.fromEntries(
        result.results.map((item) => [
          item.id,
          { verdict: item.verdict, message: item.message, evidence: item.evidence },
        ]),
      ),
      legal_outcomes: {},
    } as unknown as ScanState;
    expect(JSON.stringify(state).length).toBeGreaterThan(MAX_OPERATION_BYTES);
    const job: ScanJob = {
      id: '0123456789abcdef',
      host: 'blog.example',
      url: 'https://blog.example/',
      persistent: false,
      status: 'running',
      state,
      progressToken: null,
      attempts: 1,
      createdAt: 'x',
      updatedAt: 'x',
      scanId: null,
      result: null,
      error: null,
      errorStatus: null,
    };
    const db = limitedDatabase();
    const jobs = new SqlScanJobStore(db);
    await jobs.save(job, 'lease');
    await jobs.save({ ...job, status: 'done', state: null, result }, 'lease');
    const saves = db.statements(/^UPDATE scan_jobs SET status/);
    expect(saves).toHaveLength(2);
    for (const save of saves) expect(save.bytes).toBeLessThanOrEqual(MAX_OPERATION_BYTES);

    const [savedState] = saves[0]?.values.slice(1, 2) ?? [];
    const [savedResult] = saves[1]?.values.slice(4, 5) ?? [];
    db.script(/SELECT .* FROM scan_jobs WHERE id = \?/, [
      {
        ...Object.fromEntries(
          Object.entries({
            id: job.id,
            host: job.host,
            url: job.url,
            profile: null,
            persistent: 0,
            status: 'done',
            progress_token: null,
            attempts: 0,
            created_at: 'x',
            updated_at: 'x',
            scan_id: null,
            error: null,
            error_status: null,
          }),
        ),
        state_json: savedState,
        result_json: savedResult,
      },
    ]);
    const read = await jobs.get(job.id);
    expect(read?.state).toEqual(state);
    expect(read?.result?.results.map((item) => item.evidence)).toEqual(
      result.results.map((item) => item.evidence),
    );
  });

  it('writes the progress of a long scan and its one-time result within one operation', async () => {
    const result = await incompressibleResult();
    const events = Array.from({ length: 400 }, (_, seq) => ({
      seq: seq + 1,
      type: 'check',
      id: `A${String(seq)}`,
      verdict: 'pass',
      message: `check ${String(seq)} looked at ${randomText(200)}`,
    }));
    const db = limitedDatabase();
    await new SqlProgressStore(db).save('a'.repeat(32), {
      events,
      final: { event: 'done', data: { persistence: 'disposable', result } },
      updatedAt: 'x',
    });
    const upsert = db.statements(/INSERT INTO scan_progress/)[0];
    expect(upsert?.bytes).toBeLessThanOrEqual(MAX_OPERATION_BYTES);
    const written = (await decodeJsonColumn(String(upsert?.values[1]))) as typeof events;
    expect(written.map((event) => event.seq)).toEqual(events.map((event) => event.seq));
    expect(String(upsert?.values[2]).length).toBeLessThanOrEqual(JSON_COLUMN_BUDGET);
  });
});
