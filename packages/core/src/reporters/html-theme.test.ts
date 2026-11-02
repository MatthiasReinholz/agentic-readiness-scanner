import { runInNewContext } from 'node:vm';

import { describe, expect, it } from 'vitest';

import { htmlDocument, THEME_BOOT_SCRIPT, THEME_TOGGLE_SCRIPT } from './html-theme.js';

function themeBrowser(stored: string | null, storageFails = false) {
  const attributes = new Map([['data-theme', 'dark']]);
  const labels = new Map<string, string>();
  let click: () => void = () => {
    throw new Error('Click handler not installed');
  };
  const button = {
    hidden: true,
    setAttribute: (name: string, value: string) => labels.set(name, value),
    addEventListener: (_: string, handler: () => void) => {
      click = handler;
    },
  };
  const localStorage = {
    getItem: () => {
      if (storageFails) throw new Error('Storage blocked');
      return stored;
    },
    setItem: (_: string, value: string) => {
      if (storageFails) throw new Error('Storage blocked');
      stored = value;
    },
  };
  const context = {
    localStorage,
    document: {
      documentElement: {
        getAttribute: (name: string) => attributes.get(name),
        setAttribute: (name: string, value: string) => attributes.set(name, value),
      },
      querySelectorAll: () => [button],
    },
  };
  return {
    context,
    attributes,
    labels,
    button,
    click: () => {
      click();
    },
    stored: () => stored,
  };
}

describe('shared document chrome', () => {
  it('applies the saved theme before paint and gives the toggle an accurate action label', () => {
    const browser = themeBrowser('light');
    runInNewContext(THEME_BOOT_SCRIPT, browser.context);
    expect(browser.attributes.get('data-theme')).toBe('light');
    runInNewContext(THEME_TOGGLE_SCRIPT, browser.context);
    expect(browser.button.hidden).toBe(false);
    expect(browser.labels.get('aria-label')).toBe('Switch to dark mode');
    browser.click();
    expect(browser.attributes.get('data-theme')).toBe('dark');
    expect(browser.stored()).toBe('dark');
    expect(browser.labels.get('aria-label')).toBe('Switch to light mode');
  });

  it('defaults to dark and remains operable when storage is unavailable', () => {
    const browser = themeBrowser(null, true);
    runInNewContext(THEME_BOOT_SCRIPT, browser.context);
    runInNewContext(THEME_TOGGLE_SCRIPT, browser.context);
    expect(browser.attributes.get('data-theme')).toBe('dark');
    browser.click();
    expect(browser.attributes.get('data-theme')).toBe('light');
  });

  it('keeps the full-width hero and readable body inside the main landmark', () => {
    const html = htmlDocument(
      { title: 'Report', headerHtml: '<nav>Brand</nav>', heroHtml: '<h1>Report</h1>' },
      '<p>Findings</p>',
    );
    expect(html.indexOf('<nav>')).toBeLessThan(html.indexOf('<main'));
    expect(html.indexOf('<main')).toBeLessThan(html.indexOf('<h1>'));
    expect(html.indexOf('<h1>')).toBeLessThan(html.indexOf('class="page-content"'));
    expect(html).toContain('href="#main-content"');
    expect(html).toContain('<html lang="en" data-theme="dark">');
  });
});
