import { expect, test } from '@playwright/test';

import { expectSoundLayout } from './layout.js';

test('the theme toggle switches and remembers the theme', async ({ page }) => {
  await page.goto('/');
  const html = page.locator('html');
  await expect(html).toHaveAttribute('data-theme', 'dark');
  await page.locator('[data-theme-toggle]').first().click();
  await expect(html).toHaveAttribute('data-theme', 'light');
  await page.reload();
  await expect(html).toHaveAttribute('data-theme', 'light');
});

test.describe('without JavaScript', () => {
  test.use({ javaScriptEnabled: false });

  test('the homepage keeps a static network, hides the toggle and holds its layout', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    await page.goto('/');
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
    await expect(page.locator('[data-theme-toggle]').first()).toBeHidden();
    await expect(page.locator('.signal-network').first()).toBeVisible();
    await expect(page.locator('#scan-form')).toBeVisible();
    await expectSoundLayout(page, 'homepage without JavaScript');
  });
});
