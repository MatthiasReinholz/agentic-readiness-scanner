import type { ResultSnapshot } from '@agentic-readiness/core';
import { describe, expect, it } from 'vitest';

import { configFromEnv } from '../config.js';
import type { HistoryEntry } from '../history/types.js';
import {
  historyJson,
  historyPage,
  historySteps,
  sincePreviousPanel,
  trendChart,
} from './history.js';

const config = configFromEnv({ APP_BASE_URL: 'https://scanner.example', RETENTION_DAYS: '30' });

function entry(
  id: string,
  firstAt: string,
  lastAt: string,
  snapshot: Partial<ResultSnapshot>,
  overrides: Partial<HistoryEntry> = {},
): HistoryEntry {
  return {
    id,
    host: 'shop.example',
    url: 'https://shop.example',
    firstAt,
    lastAt,
    scans: 1,
    lastScanId: id,
    catalogVersion: '0.2.0',
    scoringVersion: '0.2.0',
    scannerVersion: '0.3.0',
    platform: 'woocommerce',
    profile: 'woocommerce-store',
    snapshot: {
      level: 1,
      ingestion: 60,
      commerce: 40,
      groups: { A1: 50, B1: 40 },
      verdicts: { 'A1.1': 'pass', 'A1.5': 'fail' },
      skips: {},
      ...snapshot,
    },
    ...overrides,
  };
}

const older = entry(
  'a000000000000001',
  '2026-09-01T00:00:00.000Z',
  '2026-09-20T00:00:00.000Z',
  {},
  {
    scans: 3,
    lastScanId: 'a000000000000003',
    catalogVersion: '0.1.3',
    scoringVersion: '0.1.1',
  },
);
const newer = entry('b000000000000001', '2026-10-28T00:00:00.000Z', '2026-10-28T00:00:00.000Z', {
  level: 2,
  ingestion: 75,
  groups: { A1: 100, B1: 40 },
  verdicts: { 'A1.1': 'pass', 'A1.5': 'pass' },
});
const entries = [newer, older];

describe('history steps and JSON', () => {
  it('pairs each state with the one before it and flags catalog changes', () => {
    const steps = historySteps(entries);
    expect(steps[0]?.previous?.id).toBe(older.id);
    expect(steps[0]?.diff?.level).toEqual({ from: 1, to: 2 });
    expect(steps[0]?.catalogChanged).toBe(true);
    expect(steps[1]?.previous).toBeNull();
    expect(steps[1]?.diff).toBeNull();
    const json = historyJson('shop.example', entries);
    expect(json.states).toHaveLength(2);
    expect(json.states[0]?.changes?.lines.slice(0, 2)).toEqual([
      'Level 1 → 2',
      'Ingestion score 60 → 75',
    ]);
    expect(json.states[0]?.changes?.lines[2]).toMatch(/^A1\.5 .*: fail → pass$/);
    expect(json.states[0]?.changes?.catalog_changed).toBe(true);
    expect(json.states[1]?.changes).toBeNull();
  });
});

describe('history page', () => {
  it('renders the states, their changes and expired reports honestly', () => {
    const html = historyPage(config, {
      host: 'shop.example',
      entries,
      now: new Date('2026-10-31T00:00:00Z'),
    });
    expect(html).toContain('2 distinct states across 4 scans');
    expect(html).toContain('Level 1 → 2');
    expect(html).toContain('Catalog 0.1.3 → 0.2.0');
    expect(html).toContain('href="/r/b000000000000001"');
    expect(html).not.toContain('href="/r/a000000000000003"');
    expect(html).toContain('Report expired');
    expect(html).toContain('<svg');
    expect(html).toContain('Scan again');
  });

  it('renders an empty page with a scan form when nothing was recorded', () => {
    const html = historyPage(config, { host: 'new.example', entries: [], now: new Date() });
    expect(html).toContain('No scans recorded');
    expect(html).not.toContain('<svg viewBox');
  });

  it('draws no chart for a single state', () => {
    expect(trendChart([newer])).toBe('');
    expect(trendChart(entries)).toContain('polyline');
  });
});

describe('since-previous panel', () => {
  it('lists the differences to the previous state and links the history', () => {
    const html = sincePreviousPanel(
      'shop.example',
      entries,
      { id: newer.id, createdAt: newer.firstAt },
      newer,
    );
    expect(html).toContain('Since the previous state');
    expect(html).toContain('Level 1 → 2');
    expect(html).toContain('catalog 0.1.3 → 0.2.0');
    expect(html).toContain('href="/h/shop.example"');
  });

  it('explains a first scan and a confirmed state', () => {
    expect(
      sincePreviousPanel(
        'shop.example',
        [older],
        { id: older.id, createdAt: older.firstAt },
        older,
      ),
    ).toContain('held since 2026-09-01');
    const single = entry(
      'c000000000000001',
      '2026-10-01T00:00:00.000Z',
      '2026-10-01T00:00:00.000Z',
      {},
    );
    expect(
      sincePreviousPanel(
        'shop.example',
        [single],
        { id: single.id, createdAt: single.firstAt },
        single,
      ),
    ).toContain('First scan of shop.example');
    expect(
      sincePreviousPanel('shop.example', entries, { id: 'zzz', createdAt: '2000-01-01' }, null),
    ).toBe('');
  });
});
