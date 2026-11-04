import { expect, test } from '@playwright/test';

import { DISPOSABLE_SCAN_URL, SEEDED_HOST } from './hosts.js';
import { expectSoundLayout, THEMES, useTheme, watchErrors, WIDTHS } from './layout.js';

/**
 * Every hosted page family from the UI audit, at every audited width in both themes. A
 * failure names the page, the width and the broken invariant.
 */
const ROUTES = [
  '/',
  '/data-processing',
  '/knowledge-base',
  '/knowledge-base/discoverability',
  '/knowledge-base/robots-txt-exists-and-parses',
  '/knowledge-base/legal-signals',
  '/knowledge-base/guides',
  '/knowledge-base/guides/crawler-blocks-and-browser-scans',
  '/knowledge-base/eu-withdrawal-button',
  `/sites/${SEEDED_HOST}`,
  `/sites/${SEEDED_HOST}/legal`,
  `/h/${SEEDED_HOST}`,
  '/monitor/confirm/unknown/token',
  '/no-such-page',
] as const;

let reportPath = '';

test.beforeAll(async ({ request }) => {
  // A repeat root scan inside the host's minute answers from the stored result.
  const response = await request.post('/api/scan', { data: { url: SEEDED_HOST } });
  expect(response.ok()).toBe(true);
  const body = (await response.json()) as { id: string };
  reportPath = `/r/${body.id}`;
});

for (const theme of THEMES) {
  for (const width of WIDTHS) {
    test(`pages hold their layout at ${String(width)}px in the ${theme} theme`, async ({
      page,
    }) => {
      const errors = watchErrors(page);
      await useTheme(page, theme);
      await page.setViewportSize({ width, height: 900 });
      for (const route of [...ROUTES, reportPath]) {
        await page.goto(route);
        await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
        await expectSoundLayout(page, `${route} at ${String(width)}px (${theme})`);
      }
      expect(errors).toEqual([]);
    });
  }
}

test('pages hold their layout with text enlarged to 200%', async ({ page }) => {
  for (const width of [320, 768] as const) {
    await page.setViewportSize({ width, height: 900 });
    for (const route of [...ROUTES, reportPath]) {
      await page.goto(route);
      await page.addStyleTag({ content: 'html{font-size:200% !important}' });
      await expectSoundLayout(page, `${route} at ${String(width)}px, 200% text`);
    }
  }
});

test.describe('disposable report', () => {
  // The path scan reserves its host; a retry would only meet the minute limit.
  test.describe.configure({ retries: 0 });

  test('a path scan renders its report in place and keeps the layout', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 900 });
    await page.goto('/');
    await page.locator('#scan-form input[name="url"]').fill(DISPOSABLE_SCAN_URL);
    await page.locator('#scan-form button[type="submit"]').click();
    await expect(page.locator('#check-map')).toBeVisible();
    await expectSoundLayout(page, 'disposable report at 375px');
  });
});

test('the URL prefix shares a line with the typed text at every width', async ({ page }) => {
  await page.goto('/');
  const field = page.locator('.url-field');
  await field.locator('input').fill('example.com');
  for (const width of WIDTHS) {
    await page.setViewportSize({ width, height: 900 });
    const geometry = await field.evaluate((label) => {
      const prefix = label.querySelector('.url-field-prefix');
      const input = label.querySelector('input');
      if (!prefix?.firstChild || !input) return null;
      const range = document.createRange();
      range.selectNodeContents(prefix.firstChild);
      const text = range.getBoundingClientRect();
      const box = input.getBoundingClientRect();
      const frame = label.getBoundingClientRect();
      return {
        centre: Math.abs(text.top + text.height / 2 - (box.top + box.height / 2)),
        gap: Math.abs(box.left - text.right),
        overflow: Math.max(frame.top - box.top, box.bottom - frame.bottom),
      };
    });
    expect(geometry, `URL field at ${String(width)}px`).not.toBeNull();
    expect(geometry?.centre, `prefix centre line at ${String(width)}px`).toBeLessThan(0.5);
    expect(geometry?.gap, `prefix to text gap at ${String(width)}px`).toBeLessThan(0.5);
    expect(geometry?.overflow, `input inside its border at ${String(width)}px`).toBeLessThanOrEqual(
      0,
    );
  }
});
