/**
 * Inter, self-hosted. The hosted app serves the latin subset of the weights the design
 * uses (copied from @fontsource/inter at build time) and inlines this @font-face block;
 * the standalone HTML report has no asset URL and falls back along the font stack, where
 * a locally installed Inter is picked up first.
 */
export const FONT_FILES = [
  { weight: 400, file: 'inter-latin-400-normal.woff2' },
  { weight: 500, file: 'inter-latin-500-normal.woff2' },
  { weight: 600, file: 'inter-latin-600-normal.woff2' },
  { weight: 700, file: 'inter-latin-700-normal.woff2' },
] as const;

const LATIN_RANGE =
  'U+0000-00FF, U+0131, U+0152-0153, U+02BB-02BC, U+02C6, U+02DA, U+02DC, U+0304, U+0308, U+0329, U+2000-206F, U+20AC, U+2122, U+2191, U+2193, U+2212, U+2215, U+FEFF, U+FFFD';

/** @font-face rules for the files served under `baseUrl` (for example `/fonts`). */
export function interFontFaceCss(baseUrl: string): string {
  const base = baseUrl.replace(/\/$/, '');
  return FONT_FILES.map(
    ({ weight, file }) =>
      `@font-face{font-family:'Inter';font-style:normal;font-display:swap;font-weight:${weight};src:url(${base}/${file}) format('woff2');unicode-range:${LATIN_RANGE}}`,
  ).join('');
}
