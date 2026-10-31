/**
 * The document shell shared by the HTML report and the hosted app: the compiled
 * stylesheet from @agentic-readiness/ui inlined (so a report stays one self-contained
 * file), the theme boot and toggle scripts, and the header and footer chrome both use.
 *
 * Dark is the default theme; a visitor's choice is kept in localStorage under
 * THEME_STORAGE_KEY and applied before first paint. Verdict and score colours are the
 * semantic layer: pass is success (green), warn is warning (amber), fail is destructive
 * (red), skip is muted.
 */
import { button, icon, THEME_CSS } from '@agentic-readiness/ui';

import { escapeHtml } from './shared.js';

export const THEME_STORAGE_KEY = 'ars-theme';

/** Applies the stored theme before first paint. Inlined in <head>. */
export const THEME_BOOT_SCRIPT = `(function(){try{var t=localStorage.getItem('${THEME_STORAGE_KEY}');if(t==='light'||t==='dark'){document.documentElement.setAttribute('data-theme',t)}}catch(e){}})();`;

/** Wires every [data-theme-toggle] button. Inlined at the end of <body>. */
export const THEME_TOGGLE_SCRIPT = `(function(){var r=document.documentElement;document.querySelectorAll('[data-theme-toggle]').forEach(function(b){b.addEventListener('click',function(){var n=r.getAttribute('data-theme')==='light'?'dark':'light';r.setAttribute('data-theme',n);try{localStorage.setItem('${THEME_STORAGE_KEY}',n)}catch(e){}})})})();`;

export function themeToggleButton(): string {
  return `<button type="button" class="${button({ variant: 'outline', size: 'sm' })} rounded-full text-muted-foreground" data-theme-toggle aria-label="Switch colour theme"><span class="hidden items-center gap-2 dark:inline-flex">${icon('moon')}Dark</span><span class="inline-flex items-center gap-2 dark:hidden">${icon('sun')}Light</span></button>`;
}

/** Brand link plus theme toggle; the first row of every page. */
export function siteHeader(appName: string, homeUrl = '/'): string {
  return `<div class="mb-8 flex items-center justify-between gap-4"><a class="inline-flex items-center gap-2.5 font-semibold text-foreground no-underline hover:no-underline" href="${escapeHtml(homeUrl)}"><span class="inline-grid size-7 place-items-center rounded-lg bg-gradient-to-br from-primary to-primary/70 text-[0.8rem] font-extrabold text-primary-foreground" aria-hidden="true">AR</span><span>${escapeHtml(appName)}</span></a>${themeToggleButton()}</div>`;
}

/** Footer row; `content` is trusted HTML. */
export function siteFooter(content: string): string {
  return `<footer class="mt-14 border-t border-border pt-5 text-sm leading-7 text-muted-foreground">${content}</footer>`;
}

/** Text colour class for a 0 to 100 score, or muted when the score does not apply. */
export function scoreTone(
  score: number | null,
): 'text-success' | 'text-warning' | 'text-destructive' | 'text-muted-foreground' {
  if (score === null) return 'text-muted-foreground';
  if (score >= 80) return 'text-success';
  if (score >= 50) return 'text-warning';
  return 'text-destructive';
}

export interface HtmlDocumentOptions {
  title: string;
  description?: string;
  /** Extra <head> markup, e.g. link relations or @font-face rules. */
  head?: string;
  /** Extra inline scripts, appended after the theme toggle wiring. */
  scripts?: string[];
}

/** Wraps page markup in a complete document with the theme applied. */
export function htmlDocument(options: HtmlDocumentOptions, body: string): string {
  const scripts = [THEME_TOGGLE_SCRIPT, ...(options.scripts ?? [])]
    .map((script) => `<script>${script}</script>`)
    .join('\n');
  return `<!doctype html>
<html lang="en" data-theme="dark">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="color-scheme" content="dark light">
<title>${escapeHtml(options.title)}</title>
${options.description ? `<meta name="description" content="${escapeHtml(options.description)}">` : ''}
${options.head ?? ''}
<script>${THEME_BOOT_SCRIPT}</script>
<style>${THEME_CSS}</style>
</head>
<body>
<main class="mx-auto w-full max-w-[960px] px-5 pb-16 pt-8 sm:px-6 sm:pb-20 sm:pt-12">
${body}
</main>
${scripts}
</body>
</html>
`;
}
