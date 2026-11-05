import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { catalog, getProfile } from '@agentic-readiness/catalog';
import { describe, expect, it } from 'vitest';

import { scan } from '../scan.js';
import { computeScores } from '../scoring.js';
import { fixtureFetcher } from '../testing/index.js';
import { renderBadge } from './badge.js';
import { renderHtml } from './html.js';
import { scoreTone, THEME_STORAGE_KEY } from './html-theme.js';
import { renderMarkdown } from './markdown.js';
import {
  ceilingSentence,
  escapeHtml,
  levelCauseSentence,
  levelLabel,
  platformResults,
  shownResults,
} from './shared.js';

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
    expect(html).toContain('What this scan did and did not do');
  });

  it('accepts host-app slots', async () => {
    const result = await scan('https://blog.example/', {
      fetcher: fixtureFetcher(fixture('content-site')),
    });
    const html = renderHtml(result, {
      afterScoresHtml: '<div id="slot-a">A</div>',
      endHtml: '<div id="slot-b">B</div>',
      scripts: ['window.__slot=1'],
      title: 'Hosted report for blog.example',
      description: 'A stored public-signal assessment.',
    });
    expect(html.indexOf('id="slot-a"')).toBeLessThan(html.indexOf('id="expand-all"'));
    expect(html).toContain('id="slot-b"');
    expect(html).toContain('<script>window.__slot=1</script>');
    expect(html).toContain('<title>Hosted report for blog.example</title>');
    expect(html).toContain(
      '<meta name="description" content="A stored public-signal assessment.">',
    );
    const standalone = renderHtml(result);
    expect(standalone).toContain(`<title>Agentic readiness: ${result.target.url}</title>`);
    expect(standalone).not.toContain('rel="canonical"');
  });

  it('lets the URL title wrap after the scheme and before path slashes, escaped', async () => {
    const result = await scan('https://blog.example/', {
      fetcher: fixtureFetcher(fixture('content-site')),
    });
    const title = (html: string) =>
      /<h1 class="hero-title"><a class="hero-title-link" href="[^"]+">(.*?)<\/a><\/h1>/.exec(
        html,
      )?.[1];
    expect(title(renderHtml(result))).toBe('https://<wbr>blog.example');
    expect(renderHtml(result)).toContain('<a class="hero-title-link" href="https://blog.example">');
    expect(
      title(renderHtml(result, { displayUrl: 'https://shop.example/en/sale?a=1&b=<2>' })),
    ).toBe('https://<wbr>shop.example<wbr>/en<wbr>/sale?a=1&amp;b=&lt;2&gt;');
    expect(title(renderHtml(result, { displayUrl: 'shop.example' }))).toBe('shop.example');
  });

  it('maps scores to tones', () => {
    expect(scoreTone(null)).toBe('text-muted-foreground');
    expect(scoreTone(49)).toBe('text-destructive');
    expect(scoreTone(50)).toBe('text-warning');
    expect(scoreTone(80)).toBe('text-success');
  });
});

describe('undetermined level', () => {
  it('says the next level is not decided instead of listing fixes', async () => {
    const result = await scan('https://blog.example/', {
      fetcher: fixtureFetcher(fixture('content-site')),
    });
    const copy = structuredClone(result);
    copy.level = { value: 0, name: 'Not reachable', next_gate: ['A2.4'], undetermined: ['A2.4'] };
    const html = renderHtml(copy);
    expect(html).toMatch(
      /Level 1 \(Reachable\) is not decided: .* could not be checked in this scan/,
    );
    expect(renderMarkdown(copy)).toMatch(/is not decided/);
    expect(html).toContain('Not decided yet');
    expect(renderMarkdown(copy)).toContain('**Level 0: Not decided yet.**');
  });
});

describe('Level 0 named by its cause', () => {
  const atLevelZero = async (gates: string[]) => {
    const result = await scan('https://blog.example/', {
      fetcher: fixtureFetcher(fixture('content-site')),
    });
    const copy = structuredClone(result);
    copy.level = { value: 0, name: 'Not reachable', next_gate: gates };
    return copy;
  };

  it('calls a site that answers but shows no product content without JavaScript not readable', async () => {
    const result = await atLevelZero(['A3.2']);
    expect(levelLabel(result)).toBe('Not readable');
    expect(levelCauseSentence(result)).toMatch(/until JavaScript runs/);
    const html = renderHtml(result);
    expect(html).toContain('>Not readable</h2>');
    expect(html).toContain('see empty pages');
    expect(renderMarkdown(result)).toMatch(/\*\*Level 0: Not readable\.\*\* The site answers, but/);
  });

  it('keeps "Not reachable" for a block and names robots.txt closures', async () => {
    expect(levelLabel(await atLevelZero(['A2.4', 'A3.2']))).toBe('Not reachable');
    const closed = await atLevelZero(['A2.2']);
    expect(levelLabel(closed)).toBe('Closed to AI crawlers');
    expect(levelCauseSentence(closed)).toMatch(/robots\.txt keeps the crawlers/);
  });

  it('leaves the catalog name and adds no cause above Level 0', async () => {
    const result = await atLevelZero([]);
    result.level = { value: 2, name: 'Readable catalog', next_gate: ['B4.1'] };
    expect(levelLabel(result)).toBe('Readable catalog');
    expect(levelCauseSentence(result)).toBe('');
  });
});

describe('Markdown report', () => {
  it('scores each section and embeds the composed brief', async () => {
    const result = await scan('https://blog.example/', {
      fetcher: fixtureFetcher(fixture('content-site')),
    });
    const markdown = renderMarkdown(result, { reportUrl: 'https://scanner.example/r/x' });
    expect(markdown).toMatch(/^### Findable: Can AI find your site and products\? \(\d+\/100\)$/m);
    expect(markdown).toContain('A1 Discoverability.');
    expect(markdown).toContain('### Browsable: Can AI see everything you sell? (not applicable)');
    // Findings are tiered and the working rules appear once, at the end.
    expect(markdown).toMatch(/^- Open findings: .*(blocking|expected|nice to have)/m);
    expect(markdown).toContain('## Fix next');
    expect(markdown).toContain('## Nice to have');
    expect(markdown.indexOf('## Fix next')).toBeLessThan(
      markdown.indexOf('## Every check, section by section'),
    );
    expect(markdown).toContain('**Task for a coding agent.**');
    expect(markdown.match(/## Working rules for coding agents/g)?.length).toBe(1);
    expect(markdown).not.toContain('## How to work');
    expect(markdown).toContain('Full report: https://scanner.example/r/x');
    expect(markdown).toContain('## What this scan did and did not do');
    expect(markdown).toMatch(/without running JavaScript, signing in/);
  });
});

describe('check map', () => {
  it('shows one linked, verdict-coloured cell per check with section scores, and an arrival script that compiles', async () => {
    const { Script } = await import('node:vm');
    const { CHECK_MAP_SCRIPT } = await import('./check-map.js');
    const result = await scan('https://blog.example/', {
      fetcher: fixtureFetcher(fixture('content-site')),
    });
    const html = renderHtml(result);
    const cells =
      html.match(/<a class="cm-cell" href="#[AB]\d\.\d+" data-v="(pass|warn|fail|skip)"/g) ?? [];
    expect(cells).toHaveLength(shownResults(result).length);
    expect(html).toContain('id="check-map"');
    // The overview carries both scores with their plain names and questions.
    expect(html).toContain('data-score="ingestion"');
    expect(html).toContain('Visible to AI');
    expect(html).toContain('Can AI find and read your site?');
    expect(html).toContain('data-verdict-summary');
    expect(html.indexOf('id="check-map"')).toBeLessThan(html.indexOf('id="priorities"'));
    expect(html).toContain('class="lv-badge');
    expect(html).toContain('@view-transition{navigation:auto}');
    expect(html).toContain(CHECK_MAP_SCRIPT);
    expect(() => new Script(CHECK_MAP_SCRIPT)).not.toThrow();
    // The animation is opt-in per arrival: the script checks the handed-over path.
    expect(CHECK_MAP_SCRIPT).toContain("v.split('|')[0]!==location.pathname");
  });
});

describe('platform-bound checks', () => {
  it('names the platform at the top, lists its checks and never mentions other platforms', async () => {
    const woo = await scan('https://ceramics.example/', {
      fetcher: fixtureFetcher(fixture('good-woocommerce')),
    });
    expect(woo.results.find((item) => item.id === 'B5.8')).toMatchObject({
      verdict: 'skip',
      skip_reason: 'not_applicable',
      message: 'requires Shopify, which was not detected',
    });
    const html = renderHtml(woo);
    const markdown = renderMarkdown(woo);
    const platformIds = platformResults(woo).map((item) => item.id);
    // WooCommerce runs on WordPress, so the WordPress checks run too.
    expect(platformIds).toEqual(expect.arrayContaining(['B1.2', 'B5.7', 'A2.8', 'A4.7']));
    expect(html).toContain('data-platform="woocommerce"');
    expect(html).toContain('<strong>WooCommerce on WordPress</strong>');
    expect(html).toContain('<a href="#B1.2">B1.2</a>');
    expect(html).toContain('data-platform-check>WooCommerce</span>');
    expect(markdown).toContain('**Platform:** WooCommerce on WordPress.');
    expect(markdown).toContain('B1.2 Store API reachable [WooCommerce]');
    for (const report of [html, markdown]) {
      expect(report).not.toContain('Shopify agentic storefront active');
      expect(report).not.toContain('Shopify products.json readable');
      expect(report).not.toContain('Magento');
      expect(report).not.toContain('left out');
    }

    const shopify = await scan('https://boots.example/', {
      fetcher: fixtureFetcher(fixture('shopify-store')),
    });
    const shopifyHtml = renderHtml(shopify);
    expect(shopifyHtml).not.toContain('id="B1.2"');
    expect(shopifyHtml).not.toContain('id="A4.7"');
    expect(shopifyHtml).toContain('id="B5.8"');
    expect(shopifyHtml).toContain('<strong>Shopify</strong>');
    expect(shopifyHtml).not.toContain('WooCommerce');
  });

  it('says plainly when no platform was recognised', async () => {
    const result = await scan('https://blog.example/', {
      fetcher: fixtureFetcher(fixture('content-site')),
    });
    const html = renderHtml({ ...result, target: { ...result.target, platform: 'unknown' } });
    expect(html).toContain('<strong>Not recognised</strong>');
    expect(html).toContain('Only the checks that apply to any site ran.');
  });
});

describe('score ceilings in reports', () => {
  it('says why a score is capped and which checks lift it', async () => {
    const full = await scan('https://ceramics.example/', {
      fetcher: fixtureFetcher(fixture('good-woocommerce')),
    });
    expect(full.scores.ceilings).toBeUndefined();
    // The same store without its UCP checkout capability and ACP document.
    const results = full.results.map((item) =>
      item.id === 'B5.2' || item.id === 'B5.3' ? { ...item, verdict: 'fail' as const } : item,
    );
    const result = {
      ...full,
      results,
      scores: computeScores(results, catalog, getProfile(full.target.profile)),
    };
    const ceiling = result.scores.ceilings?.commerce;
    expect(ceiling).toMatchObject({ id: 'no-checkout', value: 60 });
    expect(result.scores.commerce).toBe(60);
    const sentence = ceilingSentence(result, 'commerce');
    expect(sentence).toBe(
      `Capped at 60 while no checkout an agent can use is advertised. Without the cap it would be ${String(ceiling?.raw)}. Lifted by B5.2 UCP checkout capability and payment handler or B5.3 ACP discovery document.`,
    );
    expect(renderHtml(result)).toContain(`data-ceiling>${escapeHtml(sentence ?? '')}`);
    expect(renderMarkdown(result)).toContain(
      `- **Shoppable by AI** (commerce score): 60/100. ${sentence ?? ''}`,
    );
  });
});

describe('incomplete scores', () => {
  it('says a dimension is incomplete instead of printing a score that stands on one check', async () => {
    const full = await scan('https://ceramics.example/', {
      fetcher: fixtureFetcher(fixture('good-woocommerce')),
    });
    // What a slow store produced: the time budget ran out after one commerce check passed.
    const results = full.results.map((item) =>
      item.group.startsWith('B') && item.id !== 'B1.2' && item.applies
        ? {
            ...item,
            verdict: 'skip' as const,
            skip_reason: 'budget_exhausted' as const,
            evidence: {},
          }
        : item,
    );
    const result = { ...full, results, scores: computeScores(results) };
    expect(result.scores.commerce).toBeNull();

    const html = renderHtml(result, { appName: 'Scanner' });
    expect(html).toContain('>Incomplete<');
    expect(html).toContain('of the weighted checks could be answered');
    expect(html).not.toContain('Not scored for this profile');

    const markdown = renderMarkdown(result);
    expect(markdown).toMatch(
      /- \*\*Shoppable by AI\*\* \(commerce score\): incomplete \(\d+% of weighted checks answered\)/,
    );
    expect(renderBadge(result)).toContain('/–');
  });
});
