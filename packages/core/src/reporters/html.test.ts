import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { scan } from '../scan.js';
import { fixtureFetcher } from '../testing/index.js';
import { renderHtml } from './html.js';
import { scoreTone, THEME_STORAGE_KEY } from './html-theme.js';
import { renderMarkdown } from './markdown.js';

const fixture = (name: string) =>
  join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..', 'fixtures', 'stores', name);

describe('HTML report', () => {
  it('renders colour-coded, collapsible sections with a score each and an expand-all control', async () => {
    const result = await scan('https://blog.example/', {
      fetcher: fixtureFetcher(fixture('content-site')),
    });
    const html = renderHtml(result, {
      reportUrl: 'https://scanner.example/r/0123456789abcdef',
      appName: 'Scanner',
    });
    expect(html).toContain('<html lang="en" data-theme="dark">');
    expect(html).toContain(THEME_STORAGE_KEY);
    expect(html).toContain('id="expand-all"');
    expect(html.match(/<details [^>]*data-group="/g)?.length).toBe(9);
    expect(html).not.toMatch(/<details [^>]*data-group="[^"]*"[^>]*\sopen/);
    expect(html).toContain('data-verdict="fail"');
    expect(html).toContain('data-verdict="pass"');
    expect(html).toContain('data-group-score');
    expect(html).toContain('## Why you are receiving this');
    expect(html).toContain('Full report: https://scanner.example/r/0123456789abcdef');
    expect(html).toContain('data-copy="all-prompts"');
  });

  it('accepts host-app slots', async () => {
    const result = await scan('https://blog.example/', {
      fetcher: fixtureFetcher(fixture('content-site')),
    });
    const html = renderHtml(result, {
      afterScoresHtml: '<div id="slot-a">A</div>',
      endHtml: '<div id="slot-b">B</div>',
      scripts: ['window.__slot=1'],
    });
    expect(html.indexOf('id="slot-a"')).toBeLessThan(html.indexOf('id="expand-all"'));
    expect(html).toContain('id="slot-b"');
    expect(html).toContain('<script>window.__slot=1</script>');
  });

  it('maps scores to tones', () => {
    expect(scoreTone(null)).toBe('text-muted-foreground');
    expect(scoreTone(49)).toBe('text-destructive');
    expect(scoreTone(50)).toBe('text-warning');
    expect(scoreTone(80)).toBe('text-success');
  });
});

describe('Markdown report', () => {
  it('scores each section and embeds the composed brief', async () => {
    const result = await scan('https://blog.example/', {
      fetcher: fixtureFetcher(fixture('content-site')),
    });
    const markdown = renderMarkdown(result, { reportUrl: 'https://scanner.example/r/x' });
    expect(markdown).toMatch(/^## A1\. Discoverability \(\d+\/100\)$/m);
    expect(markdown).toContain('## B1. Catalog exposure (not applicable)');
    expect(markdown).toContain('Brief for a coding agent');
    expect(markdown).toContain('## How to work');
  });
});
