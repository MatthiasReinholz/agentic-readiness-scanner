import { catalog } from '@agentic-readiness/catalog';
import { expect, test } from '@playwright/test';

/** The knowledge base's navigation aids: filter, priority chips, keyboard shortcut, reading progress. */
test('the filter, chips and shortcut narrow the check list', async ({ page }) => {
  await page.goto('/knowledge-base');
  const rows = page.locator('[data-kb-row]:visible');
  const count = page.locator('#kb-count');
  await expect(rows).toHaveCount(catalog.checks.length);

  await page.keyboard.press('/');
  await expect(page.locator('#kb-filter')).toBeFocused();
  await page.keyboard.type('robots');
  const filtered = await rows.count();
  expect(filtered).toBeGreaterThan(0);
  expect(filtered).toBeLessThan(catalog.checks.length);
  await expect(count).toContainText(String(filtered));

  await page.locator('#kb-filter').fill('');
  const chip = page.locator('.kb-chip').first();
  await chip.click();
  await expect(chip).toHaveAttribute('aria-pressed', 'true');
  const tier = await chip.getAttribute('data-tier');
  const visibleTiers = await rows.evaluateAll((items) => [
    ...new Set(items.map((item) => item.getAttribute('data-tier'))),
  ]);
  expect(visibleTiers).toEqual([tier]);
  await chip.click();
  await expect(chip).toHaveAttribute('aria-pressed', 'false');
  await expect(rows).toHaveCount(catalog.checks.length);
});

test('an article marks the reader position in the rail, strip and contents', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto('/knowledge-base/robots-txt-exists-and-parses');
  await expect(page.locator('[aria-current="step"], [aria-current="page"]').first()).toBeAttached();
  await page.locator('h2').last().scrollIntoViewIfNeeded();
  await expect(page.locator('.kb-toc a[data-active]').first()).toBeAttached();
});

test('legal signals stay out of the readiness index and have a hub of their own', async ({
  page,
}) => {
  await page.goto('/knowledge-base');
  await expect(page.locator('[data-kb-row]')).toHaveCount(catalog.checks.length);
  await page.getByRole('link', { name: 'Read about legal signals' }).click();
  await expect(page).toHaveURL(/\/knowledge-base\/legal-signals$/);
  await expect(page.locator('#legal-notice, [role="note"]').first()).toContainText(
    'not legal advice',
  );
  await expect(page.locator('.kb-check-row')).toHaveCount(catalog.legal.checks.length);
});
