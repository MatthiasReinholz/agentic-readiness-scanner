/**
 * JavaScript front-end frameworks a page was built with, read from the traces each one
 * leaves in its server-rendered HTML and headers. A headless storefront (a front end of
 * its own that reads the shop system's data over an API) shows these instead of the
 * platform's theme. Each marker is written by the framework itself into the HTML it
 * renders (a root element id, a data script, its asset folder or its X-Powered-By header).
 */
import type { HtmlDocument } from './html.js';

export type FrontendFramework =
  'Next.js' | 'Nuxt' | 'Gatsby' | 'Remix' | 'React Router' | 'Astro' | 'SvelteKit' | 'Angular';

export interface FrameworkMatch {
  framework: FrontendFramework;
  /** The trace that matched, as evidence names it. */
  signal: string;
}

interface Page {
  doc: HtmlDocument;
  /** The body as served, not lower-cased: some markers are case-sensitive globals. */
  body: string;
  headers: Record<string, string>;
}

interface Marker {
  signal: string;
  test: (page: Page) => boolean;
}

const hasId = (page: Page, tag: string, id: string): boolean =>
  page.doc.find(tag, 'id', new RegExp(`^${id}$`)).length > 0;

const poweredBy = (page: Page, pattern: RegExp): boolean =>
  pattern.test(page.headers['x-powered-by'] ?? '');

/** In the order they are tried; the first framework with a match wins. */
const MARKERS: readonly (readonly [FrontendFramework, readonly Marker[]])[] = [
  [
    'Next.js',
    [
      { signal: '__NEXT_DATA__ script', test: (p) => hasId(p, 'script', '__NEXT_DATA__') },
      { signal: 'self.__next_f script', test: (p) => p.body.includes('self.__next_f') },
      { signal: '/_next/static/ assets', test: (p) => p.body.includes('/_next/static/') },
      { signal: 'X-Powered-By: Next.js', test: (p) => poweredBy(p, /next\.js/i) },
    ],
  ],
  [
    'Nuxt',
    [
      { signal: '__nuxt root element', test: (p) => hasId(p, 'div', '__nuxt') },
      { signal: '__NUXT_DATA__ script', test: (p) => hasId(p, 'script', '__NUXT_DATA__') },
      { signal: 'window.__NUXT__ script', test: (p) => p.body.includes('window.__NUXT__') },
      { signal: '/_nuxt/ assets', test: (p) => p.body.includes('/_nuxt/') },
      { signal: 'X-Powered-By: Nuxt', test: (p) => poweredBy(p, /nuxt/i) },
    ],
  ],
  ['Gatsby', [{ signal: '___gatsby root element', test: (p) => hasId(p, 'div', '___gatsby') }]],
  [
    'React Router',
    [
      {
        signal: '__reactRouterContext script',
        test: (p) => p.body.includes('window.__reactRouterContext'),
      },
    ],
  ],
  [
    'Remix',
    [{ signal: '__remixContext script', test: (p) => p.body.includes('window.__remixContext') }],
  ],
  [
    'Astro',
    [{ signal: 'astro-island element', test: (p) => p.doc.elements('astro-island').length > 0 }],
  ],
  [
    'SvelteKit',
    [
      { signal: '__sveltekit script', test: (p) => p.body.includes('__sveltekit_') },
      { signal: 'data-sveltekit attribute', test: (p) => p.body.includes('data-sveltekit-') },
    ],
  ],
  ['Angular', [{ signal: 'ng-version attribute', test: (p) => /\sng-version="\d/.test(p.body) }]],
];

/** The front-end framework the page shows, or null when none of the known traces is there. */
export function detectFramework(
  doc: HtmlDocument,
  body: string,
  headers: Record<string, string>,
): FrameworkMatch | null {
  const page: Page = { doc, body, headers };
  for (const [framework, markers] of MARKERS) {
    const hit = markers.find((marker) => marker.test(page));
    if (hit) return { framework, signal: hit.signal };
  }
  return null;
}
