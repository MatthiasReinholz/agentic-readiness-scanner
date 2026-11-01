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
    // The priorities card comes before the sections and links into them.
    expect(html.indexOf('id="priorities"')).toBeLessThan(html.indexOf('id="expand-all"'));
    // A content site at its maximum level has no gate to unlock, so the card opens with "Fix next".
    expect(html).toContain('What to do');
    expect(html).toContain('Fix next');
    expect(html).toMatch(/href="#A\d\.\d+"/);
    // Protocol discovery is nice to have only, so its zero is muted and tagged.
    expect(html).toMatch(/data-group="A4"[\s\S]*?data-group-optional/);
    expect(html).toContain('did not apply to this site');
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
    expect(markdown).toMatch(/^### A1\. Discoverability \(\d+\/100\)$/m);
    expect(markdown).toContain('### B1. Catalog exposure (not applicable)');
    // Findings are tiered and the working rules appear once, at the end.
    expect(markdown).toMatch(/^- Open findings: .*(blocking|expected|nice to have)/m);
    expect(markdown).toContain('## Fix next');
    expect(markdown).toContain('## Nice to have');
    expect(markdown.indexOf('## Fix next')).toBeLessThan(markdown.indexOf('## Results by section'));
    expect(markdown).toContain('**Task for a coding agent.**');
    expect(markdown.match(/## Working rules for coding agents/g)?.length).toBe(1);
    expect(markdown).not.toContain('## How to work');
    expect(markdown).toContain('Full report: https://scanner.example/r/x');
  });
});
