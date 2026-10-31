import { describe, expect, it } from 'vitest';

import { describeDiff, diffSnapshots, type ResultSnapshot } from './diff.js';

const base: ResultSnapshot = {
  level: 1,
  ingestion: 80,
  commerce: 60,
  verdicts: { 'A1.1': 'pass', 'B1.2': 'fail', 'B2.1': 'skip' },
};

describe('diffSnapshots', () => {
  it('reports no change for identical snapshots', () => {
    const diff = diffSnapshots(base, { ...base, verdicts: { ...base.verdicts } });
    expect(diff.changed).toBe(false);
    expect(describeDiff(diff)).toEqual([]);
  });

  it('lists level, score and verdict changes including checks that appeared or vanished', () => {
    const diff = diffSnapshots(base, {
      level: 2,
      ingestion: 80,
      commerce: 75,
      verdicts: { 'A1.1': 'pass', 'B1.2': 'pass', 'B5.1': 'warn' },
    });
    expect(diff.changed).toBe(true);
    expect(diff.level).toEqual({ from: 1, to: 2 });
    expect(diff.ingestion).toBeNull();
    expect(diff.commerce).toEqual({ from: 60, to: 75 });
    expect(diff.checks.map((item) => `${item.id}:${item.from}>${item.to}`)).toEqual([
      'B1.2:fail>pass',
      'B2.1:skip>absent',
      'B5.1:absent>warn',
    ]);
    const lines = describeDiff(diff);
    expect(lines[0]).toBe('Level 1 → 2');
    expect(lines[1]).toBe('Commerce score 60 → 75');
    expect(lines[2]).toMatch(/^B1\.2 .+: fail → pass$/);
  });
});
