import { expect, type Page } from '@playwright/test';

/** The audited widths: phone, large phone, tablet, small laptop and desktop. */
export const WIDTHS = [320, 375, 768, 1024, 1440] as const;
export const THEMES = ['dark', 'light'] as const;
export type Theme = (typeof THEMES)[number];

/** Restores a stored theme before the first paint, as a returning visitor would. */
export async function useTheme(page: Page, theme: Theme): Promise<void> {
  await page.addInitScript((value) => {
    try {
      localStorage.setItem('ars-theme', value);
    } catch {
      // Storage can be unavailable; the page then keeps its default theme.
    }
  }, theme);
}

/**
 * Collects uncaught exceptions, console errors and failed subresources (stylesheets,
 * fonts, scripts, images) for the lifetime of the page. Documents may answer 404 on
 * purpose, so their status is the route's business, not an error here.
 */
export function watchErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => {
    if (message.type() === 'error' && !message.text().startsWith('Failed to load resource'))
      errors.push(message.text());
  });
  page.on('response', (response) => {
    if (response.status() >= 400 && response.request().resourceType() !== 'document')
      errors.push(`${String(response.status())} ${response.url()}`);
  });
  return errors;
}

export interface LayoutReport {
  overflow: number;
  brokenIdentifiers: string[];
  smallTargets: string[];
  mains: number;
  hasHeader: boolean;
  hasFooter: boolean;
}

/**
 * The invariants of the UI audit, measured in the page: no page-level horizontal scroll,
 * catalog identifiers on one unclipped line, 44px controls, and one shared shell.
 */
export async function measureLayout(page: Page): Promise<LayoutReport> {
  return page.evaluate(() => {
    const visible = (element: Element) => {
      const box = element.getBoundingClientRect();
      return box.width > 0 && box.height > 0;
    };
    const describe = (element: Element) =>
      `${element.tagName.toLowerCase()} "${(element.textContent ?? element.getAttribute('aria-label') ?? '').trim().slice(0, 30)}"`;
    const brokenIdentifiers = [...document.querySelectorAll('.ui-identifier')]
      .filter(visible)
      .filter(
        (element) =>
          element.getClientRects().length > 1 || element.scrollWidth > element.clientWidth + 1,
      )
      .map(describe);
    const controls =
      'button, select, input:not([type=hidden]):not([type=checkbox]):not([type=radio]), .kb-chip';
    const smallTargets = [...document.querySelectorAll(controls)]
      .filter(visible)
      .filter((element) => element.getBoundingClientRect().height < 43.5)
      .map(describe);
    return {
      overflow: document.documentElement.scrollWidth - window.innerWidth,
      brokenIdentifiers,
      smallTargets,
      mains: document.querySelectorAll('main').length,
      hasHeader: document.querySelector('.site-header nav[aria-label]') !== null,
      hasFooter: document.querySelector('footer') !== null,
    };
  });
}

export async function expectSoundLayout(page: Page, label: string): Promise<void> {
  const report = await measureLayout(page);
  expect.soft(report.overflow, `${label}: horizontal overflow in px`).toBeLessThanOrEqual(0);
  expect.soft(report.brokenIdentifiers, `${label}: wrapped or clipped identifiers`).toEqual([]);
  expect.soft(report.smallTargets, `${label}: controls under 44px`).toEqual([]);
  expect.soft(report.mains, `${label}: main landmarks`).toBe(1);
  expect
    .soft(report.hasHeader && report.hasFooter, `${label}: shared header and footer`)
    .toBe(true);
}
