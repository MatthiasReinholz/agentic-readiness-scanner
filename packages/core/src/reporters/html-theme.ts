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
import { icon, signalNetwork, SIGNAL_NETWORK_SCRIPT, THEME_CSS } from '@agentic-readiness/ui';

import { escapeHtml } from './shared.js';

export const THEME_STORAGE_KEY = 'ars-theme';

/** Applies the stored theme before first paint. Inlined in <head>. */
export const THEME_BOOT_SCRIPT = `(function(){try{var t=localStorage.getItem('${THEME_STORAGE_KEY}');if(t==='light'||t==='dark'){document.documentElement.setAttribute('data-theme',t)}}catch(e){}})();`;

/** Wires every [data-theme-toggle] button. Inlined at the end of <body>. */
export const THEME_TOGGLE_SCRIPT = `(function(){
  var root=document.documentElement;
  var buttons=document.querySelectorAll('[data-theme-toggle]');
  function paint(){
    buttons.forEach(function(button){
      button.setAttribute('aria-label',root.getAttribute('data-theme')==='light'?'Switch to dark mode':'Switch to light mode');
    });
  }
  buttons.forEach(function(button){
    button.hidden=false;
    button.addEventListener('click',function(){
      var theme=root.getAttribute('data-theme')==='light'?'dark':'light';
      root.setAttribute('data-theme',theme);
      try{localStorage.setItem('${THEME_STORAGE_KEY}',theme)}catch(_){}
      paint();
    });
  });
  paint();
})();`;

export function themeToggleButton(): string {
  return `<button type="button" class="theme-toggle" data-theme-toggle aria-label="Switch to light mode" hidden><span class="hidden dark:inline-flex">${icon('sun', 'size-5')}</span><span class="inline-flex dark:hidden">${icon('moon', 'size-5')}</span></button>`;
}

/** Brand link plus theme toggle; the first row of every page. */
export function siteHeader(appName: string, homeUrl = '/'): string {
  const knowledgeUrl = `${homeUrl.replace(/\/?$/, '/')}knowledge-base`;
  return `<div class="site-header"><nav class="site-container site-nav" aria-label="Main navigation"><a class="site-brand" href="${escapeHtml(homeUrl)}"><span class="site-monogram" aria-hidden="true">AR</span><span>${escapeHtml(appName)}</span></a><a class="site-knowledge" href="${escapeHtml(knowledgeUrl)}">Knowledge base${icon('arrow-right', 'size-4')}</a>${themeToggleButton()}</nav></div>`;
}

/** Trusted, escaped-by-the-caller content, with decoration isolated from real scan state. */
export function pageHero(content: string, options: { home?: boolean } = {}): string {
  return `<section class="site-hero${options.home ? ' site-hero-home' : ''}">${signalNetwork()}<div class="site-container hero-content">${content}</div></section>`;
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
  /** Trusted full-width navigation, outside the main landmark. */
  headerHtml?: string;
  /** Trusted full-width hero inside the main landmark, before the readable content. */
  heroHtml?: string;
}

/** Wraps page markup in a complete document with the theme applied. */
export function htmlDocument(options: HtmlDocumentOptions, body: string): string {
  const scripts = [THEME_TOGGLE_SCRIPT, SIGNAL_NETWORK_SCRIPT, ...(options.scripts ?? [])]
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
<a class="skip-link" href="#main-content">Skip to content</a>
${options.headerHtml ?? ''}
<main id="main-content" tabindex="-1">
${options.heroHtml ?? ''}
<div class="page-content">
${body}
</div>
</main>
${scripts}
</body>
</html>
`;
}
