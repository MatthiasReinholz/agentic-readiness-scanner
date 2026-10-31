import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { parseCliArguments } from './args.js';
import { main } from './index.js';

const fixture = join(
  dirname(fileURLToPath(import.meta.url)),
  '..',
  '..',
  '..',
  'fixtures',
  'stores',
  'good-woocommerce',
);

describe('parseCliArguments', () => {
  it('parses a scan with options', () => {
    expect(
      parseCliArguments([
        'scan',
        'example.shop',
        '--format',
        'json',
        '--budget',
        '10',
        '--profile',
        'other-store',
      ]),
    ).toEqual({
      command: 'scan',
      url: 'example.shop',
      format: 'json',
      budget: 10,
      profile: 'other-store',
    });
  });

  it('rejects an unknown format', () => {
    expect(() => parseCliArguments(['scan', 'x', '--format', 'pdf'])).toThrow(/unknown format/);
  });

  it('defaults to help', () => {
    expect(parseCliArguments([])).toEqual({ command: 'help' });
  });
});

describe('main', () => {
  it('scans a fixture and prints JSON', async () => {
    let out = '';
    const code = await main(
      ['scan', 'ceramics.example', '--fixture', fixture, '--format', 'json'],
      {
        stdout: (text) => {
          out += text;
        },
        stderr: () => undefined,
      },
    );
    expect(code).toBe(0);
    const parsed = JSON.parse(out) as { target: { platform: string }; level: { value: number } };
    expect(parsed.target.platform).toBe('woocommerce');
    expect(parsed.level.value).toBeGreaterThanOrEqual(1);
  });

  it('returns 2 for an unreachable target', async () => {
    let err = '';
    const code = await main(['scan', 'https://missing.example/', '--fixture', fixture], {
      stdout: () => undefined,
      stderr: (text) => {
        err += text;
      },
    });
    expect(code).toBe(2);
    expect(err).toMatch(/not reachable/);
  });

  it('prints the catalog', async () => {
    let out = '';
    await main(['catalog'], { stdout: (text) => (out += text), stderr: () => undefined });
    expect(out).toContain('B3.1');
  });
});
