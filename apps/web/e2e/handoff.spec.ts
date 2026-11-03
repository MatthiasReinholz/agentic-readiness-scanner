import { catalog } from '@agentic-readiness/catalog';
import { expect, test, type Page } from '@playwright/test';

import { LIVE_SCAN_HOST, SEEDED_HOST } from './hosts.js';
import { watchErrors } from './layout.js';

/**
 * The scan console hands over to the report: both share the check-map and level-badge
 * view-transition names, the console leaves a path-scoped arrival marker, and the report
 * plays its completion once. A reload, a shared link or reduced motion never replays it.
 */
async function transitionName(page: Page, selector: string): Promise<string> {
  return page
    .locator(selector)
    .first()
    .evaluate((element) => getComputedStyle(element).viewTransitionName);
}

test('a root scan streams in the console and arrives at its report once', async ({ page }) => {
  const errors = watchErrors(page);
  await page.goto('/');
  expect(await transitionName(page, '#sc-grid')).toBe('check-map');
  await page.locator('#scan-form input[name="url"]').fill(`https://${LIVE_SCAN_HOST}/`);
  await page.locator('#scan-form button[type="submit"]').click();
  await expect(page.locator('#scan-console')).toBeVisible();
  await page.waitForURL(`**/sites/${LIVE_SCAN_HOST}`);

  expect(await transitionName(page, '.cm-grid')).toBe('check-map');
  expect(await transitionName(page, '.lv-badge')).toBe('level-badge');
  await expect(page.locator('.cm-grid .cm-cell')).toHaveCount(catalog.checks.length);
  await expect(page.locator('.lv-badge')).toHaveClass(/lv-celebrate/);
  await expect(page.locator('.cm-done-slot')).toContainText('Scan complete in');

  await page.reload();
  await expect(page.locator('.cm-done-slot')).toHaveText('');
  await expect(page.locator('.lv-badge')).not.toHaveClass(/lv-celebrate/);
  expect(errors).toEqual([]);
});

async function arriveAt(page: Page, path: string): Promise<void> {
  await page.addInitScript((marker) => {
    if (!sessionStorage.getItem('arrival-set')) {
      sessionStorage.setItem('arrival-set', '1');
      sessionStorage.setItem('ars-arrived', marker);
    }
  }, `${path}|1.2 s`);
  await page.goto(path);
}

test('the arrival marker only plays on the report it names', async ({ page }) => {
  await page.addInitScript(() => {
    sessionStorage.setItem('ars-arrived', '/sites/elsewhere.example|1.2 s');
  });
  await page.goto(`/sites/${SEEDED_HOST}`);
  await expect(page.locator('.cm-done-slot')).toHaveText('');
});

test('the arrival plays the wave and the badge celebration', async ({ page }) => {
  await arriveAt(page, `/sites/${SEEDED_HOST}`);
  await expect(page.locator('.cm-grid')).toHaveClass(/cm-arrive/);
  await expect(page.locator('.lv-badge')).toHaveClass(/lv-celebrate/);
  await expect(page.locator('.cm-done-slot')).toHaveText(
    'Scan complete in 1.2 s. Click any cell to jump to its check.',
  );
});

test.describe('with reduced motion', () => {
  test.use({ reducedMotion: 'reduce' });

  test('the arrival does not animate', async ({ page }) => {
    await arriveAt(page, `/sites/${SEEDED_HOST}`);
    await expect(page.locator('.cm-grid')).toBeVisible();
    await page.waitForTimeout(300);
    await expect(page.locator('.cm-grid')).not.toHaveClass(/cm-arrive/);
    await expect(page.locator('.lv-badge')).not.toHaveClass(/lv-celebrate/);
  });
});

test('every map cell links to a check on the page', async ({ page }) => {
  await page.goto(`/sites/${SEEDED_HOST}`);
  const targets = await page.locator('.cm-grid .cm-cell').evaluateAll(
    (cells) =>
      cells.filter((cell) => {
        const id = cell.getAttribute('href')?.slice(1) ?? '';
        return document.getElementById(id) === null;
      }).length,
  );
  expect(targets).toBe(0);
});
