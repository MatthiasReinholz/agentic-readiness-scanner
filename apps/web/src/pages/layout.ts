import {
  escapeHtml,
  htmlDocument,
  pageHero,
  siteFooter,
  siteHeader,
} from '@agentic-readiness/core';
import { FONT_FILES, interFontFaceCss } from '@agentic-readiness/ui';

import type { AppConfig } from '../config.js';

export interface PageOptions {
  title: string;
  description?: string;
  head?: string;
  scripts?: string[];
  /** Trusted hero content; escape data before composing it. */
  hero?: string;
  home?: boolean;
}

/** Where build.mjs puts the Inter files and dev.ts serves them from. */
export const FONT_URL_PATH = '/fonts';

/**
 * <head> additions for every hosted page: icon, llms.txt relation, and the self-hosted
 * Inter faces with the two weights most text uses preloaded.
 */
export function hostedHead(): string {
  const preload = FONT_FILES.filter(({ weight }) => weight === 400 || weight === 600)
    .map(
      ({ file }) =>
        `<link rel="preload" href="${FONT_URL_PATH}/${file}" as="font" type="font/woff2" crossorigin>`,
    )
    .join('\n');
  return `<link rel="icon" href="/favicon.svg" type="image/svg+xml">
<link rel="alternate" type="text/markdown" href="/llms.txt" title="llms.txt">
${preload}
<style>${interFontFaceCss(FONT_URL_PATH)}</style>`;
}

/** The footer every hosted page and report carries. */
export function hostedFooterHtml(config: AppConfig): string {
  return `An experiment by <a href="https://matthiasreinholz.com/about/" rel="author">Matthias Reinholz</a> · <a href="/knowledge-base">Knowledge base</a> · <a href="${escapeHtml(config.repositoryUrl)}">Source on GitHub</a>`;
}

/** Wraps page markup in the shared document shell: header with brand and theme toggle, footer. */
export function page(config: AppConfig, options: PageOptions, body: string): string {
  return htmlDocument(
    {
      title: options.title,
      ...(options.description ? { description: options.description } : {}),
      head: `${hostedHead()}\n${options.head ?? ''}`,
      headerHtml: siteHeader(config.appName),
      ...(options.hero
        ? { heroHtml: pageHero(options.hero, { home: options.home === true }) }
        : {}),
      ...(options.scripts ? { scripts: options.scripts } : {}),
    },
    `${body}\n${siteFooter(hostedFooterHtml(config))}`,
  );
}

/** A short message page (errors, not found). */
export function messagePage(
  config: AppConfig,
  title: string,
  text: string,
  status: { kind: 'error' | 'plain' } = { kind: 'plain' },
): string {
  const tone = status.kind === 'error' ? 'text-destructive' : 'text-foreground';
  return page(
    config,
    {
      title,
      hero: `<p class="hero-eyebrow">Agentic readiness</p><h1 class="hero-title">${escapeHtml(title)}</h1>`,
    },
    `<section class="space-y-3"><p class="${tone}">${text}</p></section>`,
  );
}
