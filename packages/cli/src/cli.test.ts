import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterAll, describe, expect, it } from 'vitest';

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

/** Runs the CLI and captures both streams. */
async function run(argv: string[]): Promise<{ code: number; out: string; err: string }> {
  let out = '';
  let err = '';
  const code = await main(argv, {
    stdout: (text) => {
      out += text;
    },
    stderr: (text) => {
      err += text;
    },
  });
  return { code, out, err };
}

describe('parseCliArguments', () => {
  it('parses a scan with options', () => {
    expect(
      parseCliArguments([
        'scan',
        'example.com',
        '--format',
        'json',
        '--budget',
        '10',
        '--profile',
        'other-store',
      ]),
    ).toEqual({
      command: 'scan',
      url: 'example.com',
      format: 'json',
      budget: 10,
      profile: 'other-store',
    });
  });

  it('rejects an unknown format, profile or option and a non-numeric budget', () => {
    expect(() => parseCliArguments(['scan', 'x', '--format', 'pdf'])).toThrow(/unknown format/);
    expect(() => parseCliArguments(['scan', 'x', '--profile', 'shop'])).toThrow(
      /unknown profile shop \(expected woocommerce-store, other-store, content-site\)/,
    );
    expect(() => parseCliArguments(['scan', 'x', '--bogus'])).toThrow(/Unknown option '--bogus'/);
    expect(() => parseCliArguments(['scan', 'x', '--budget', 'ten'])).toThrow(
      /--budget must be a positive integer/,
    );
  });

  it('defaults to help', () => {
    expect(parseCliArguments([])).toEqual({ command: 'help' });
  });
});

describe('main', () => {
  it('scans a fixture and prints JSON', async () => {
    const { code, out } = await run([
      'scan',
      'ceramics.example',
      '--fixture',
      fixture,
      '--format',
      'json',
    ]);
    expect(code).toBe(0);
    const parsed = JSON.parse(out) as { target: { platform: string }; level: { value: number } };
    expect(parsed.target.platform).toBe('woocommerce');
    expect(parsed.level.value).toBeGreaterThanOrEqual(1);
  });

  it('renders Markdown by default, and HTML and a badge on request', async () => {
    const md = await run(['scan', 'ceramics.example', '--fixture', fixture]);
    expect(md.code).toBe(0);
    expect(md.out).toContain('# Agentic readiness report for https://ceramics.example');
    const html = await run(['scan', 'ceramics.example', '--fixture', fixture, '-f', 'html']);
    expect(html.out.startsWith('<!doctype html>')).toBe(true);
    expect(html.out).toContain('ceramics.example');
    const badge = await run([
      'scan',
      'ceramics.example',
      '--fixture',
      fixture,
      '--format',
      'badge',
    ]);
    expect(badge.out).toContain('<svg');
    expect(badge.out).toContain('Level');
  });

  describe('--output', () => {
    const directory = mkdtempSync(join(tmpdir(), 'agentic-readiness-'));
    afterAll(() => {
      rmSync(directory, { recursive: true, force: true });
    });

    it('writes the report to the file and says so on stderr, printing nothing to stdout', async () => {
      const file = join(directory, 'report.json');
      const { code, out, err } = await run([
        'scan',
        'ceramics.example',
        '--fixture',
        fixture,
        '--format',
        'json',
        '--output',
        file,
      ]);
      expect(code).toBe(0);
      expect(out).toBe('');
      expect(err).toBe(`Wrote ${file}\n`);
      const written = JSON.parse(readFileSync(file, 'utf8')) as { target: { url: string } };
      expect(written.target.url).toBe('https://ceramics.example');
    });
  });

  it('diffs two saved reports and exits 3 only when something changed', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'ars-diff-'));
    try {
      const before = join(dir, 'before.json');
      const after = join(dir, 'after.json');
      await run([
        'scan',
        'ceramics.example',
        '--fixture',
        fixture,
        '--format',
        'json',
        '--output',
        before,
      ]);
      const same = await run(['diff', before, before]);
      expect(same.code).toBe(0);
      expect(same.out).toContain('No change.');
      const parsed = JSON.parse(readFileSync(before, 'utf8')) as {
        results: { verdict: string }[];
      };
      const first = parsed.results.find((item) => item.verdict === 'pass');
      if (first) first.verdict = 'fail';
      writeFileSync(after, JSON.stringify(parsed));
      const changed = await run(['diff', before, after]);
      expect(changed.code).toBe(3);
      expect(changed.out).toMatch(/pass → fail/);
      const json = await run(['diff', before, after, '--format', 'json']);
      expect((JSON.parse(json.out) as { changed: boolean }).changed).toBe(true);
      expect((await run(['diff', before])).code).toBe(1);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('returns 2 for an unreachable target', async () => {
    const { code, err } = await run(['scan', 'https://missing.example/', '--fixture', fixture]);
    expect(code).toBe(2);
    expect(err).toMatch(/not reachable/);
  });

  it('returns 1 with the reason for a bad profile or an unknown option', async () => {
    const profile = await run(['scan', 'ceramics.example', '--fixture', fixture, '-p', 'shop']);
    expect(profile.code).toBe(1);
    expect(profile.err).toMatch(/^unknown profile shop/);
    const option = await run(['scan', 'ceramics.example', '--bogus']);
    expect(option.code).toBe(1);
    expect(option.err).toMatch(/Unknown option '--bogus'/);
    const command = await run(['frobnicate']);
    expect(command.code).toBe(1);
    expect(command.err).toMatch(/^unknown command frobnicate/);
  });

  it('prints the catalog, the version and the usage', async () => {
    expect((await run(['catalog'])).out).toContain('B3.1');
    expect((await run(['version'])).out).toMatch(/^\d+\.\d+\.\d+/);
    expect((await run(['--help'])).out).toContain('agentic-readiness <command> [options]');
  });
});
