import { describe, expect, it } from 'vitest';

import {
  badge,
  button,
  cn,
  FONT_FILES,
  icon,
  ICON_SVG,
  interFontFaceCss,
  THEME_CSS,
} from './index.js';

describe('ui package', () => {
  it('compiles the token contract and both themes into the stylesheet', () => {
    expect(THEME_CSS).toContain('--primary:');
    expect(THEME_CSS).toContain('[data-theme=dark]');
    expect(THEME_CSS).toContain('.bg-primary');
    // Classes written in the report renderer and the hosted pages are picked up.
    expect(THEME_CSS).toContain('.group-open\\/section\\:rotate-90');
    expect(THEME_CSS).toContain('.backdrop\\:bg-black\\/60');
  });

  it('composes variants from complete class literals', () => {
    expect(button()).toContain('bg-primary');
    expect(button({ variant: 'outline', size: 'sm' })).toContain('h-9');
    expect(badge({ variant: 'destructive' })).toContain('text-destructive');
    expect(cn('p-2 p-4', 'text-sm')).toBe('p-4 text-sm');
  });

  it('inlines lucide icons without fixed dimensions', () => {
    const svg = icon('chevron-down', 'size-4');
    expect(svg).toMatch(/^<svg class="size-4" aria-hidden="true" xmlns=/);
    expect(svg).not.toContain('width="24"');
    expect(Object.keys(ICON_SVG).length).toBeGreaterThan(10);
  });

  it('emits one @font-face per served weight', () => {
    const css = interFontFaceCss('/fonts/');
    expect(css.match(/@font-face/g)?.length).toBe(FONT_FILES.length);
    expect(css).toContain('url(/fonts/inter-latin-400-normal.woff2)');
  });
});
