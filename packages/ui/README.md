# @agentic-readiness/ui

The visual system shared by the HTML report (`@agentic-readiness/core`) and the hosted app (`apps/web`). It follows the framework layer of the app-base UI standard and nothing above it: Tailwind CSS with the shadcn token contract, class recipes transcribed from its primitives, lucide icons and self-hosted Inter. No React, no component runtime; everything is a string for server-rendered HTML. See [decision 0008](../../docs/decisions/0008-ui-standard.md).

## What it exports

- `THEME_CSS`: the compiled, minified stylesheet. `htmlDocument` in core inlines it, so a report written by the CLI is one self-contained file.
- Recipes (`src/recipes.ts`): `button({ variant, size })`, `badge({ variant })`, `card` and its parts, `input`, `nativeSelect` with wrapper and chevron, `textarea`, `label`, `alert({ variant })`, `separator`, `codeInline`, `codeBlock`, and `cn` for merging class lists.
- `icon(name, className?)`: an inline lucide SVG; the names are listed in `scripts/build-assets.mjs`.
- `interFontFaceCss(baseUrl)` and `FONT_FILES` for the self-hosted font faces the hosted app serves under `/fonts`.
- `signalNetwork()` and `SIGNAL_NETWORK_SCRIPT`: inline decorative network geometry and its pause control. These never represent check outcomes or make network requests.

## Signal Network design

`src/theme.css` owns all colour tokens. The hero uses Woo Purple 40 (`#873EFF`), white copy and a pale lime (`#F5FF90`) highlight; the scan action uses Woo Purple 50 (`#720EEC`). These pairs have contrast ratios of 5.04:1, 4.71:1 and 7.02:1 respectively. The colour reference is [Woo's public palette](https://woocommerce.com/brand-and-logo-guidelines/); the scanner keeps its own identity. Theme-specific primary colours remain separate from the hero and from verdict colours, so links stay readable on both themes.

`src/surfaces.css` owns shared composition: full-width navigation and hero surfaces, the 1200px maximum inner grid, responsive headings and scan form, and network motion. The body keeps readable line lengths inside that grid; article prose is capped separately. Controls align on a 52px baseline in the hero, stack below 768px, and use visible keyboard focus and hover feedback. Inter's existing 700 weight supplies the display heading without an additional font download.

Core's `htmlDocument` accepts trusted `headerHtml` outside the main landmark and `heroHtml` inside it. `pageHero` and `siteHeader` compose those surfaces for the web app and standalone HTML reports. Escape user data before passing it to these helpers. Do not recreate page-specific colours or duplicate the document shell. Hosted pages use the same shell for the knowledge base, history, monitoring and errors.

Only the homepage's decorative signals loop. The pause button remembers the visitor's choice under `ars-motion`; the OS reduced-motion preference always takes precedence. Active scanning pauses the ambient network while real verdicts continue updating. Compact page and report heroes remain static. No-JavaScript pages show a static network and hide inactive motion/theme controls. Dark is the default; `ars-theme` restores a visitor's explicit theme before paint.

The scan console and report keep the `check-map` and `level-badge` view-transition names and the path-scoped `ars-arrived` handoff. A shared link or reload does not replay the arrival. Verdict maps use symbols as well as colour and report cells have 24px targets; skipped cells remain dashed. Do not replace real progress with decorative particles or delay the report to finish an ambient animation.

For UI changes, run `pnpm check` and review rendered home, scanning, report, knowledge index/section/article, history, monitoring and error pages in both themes. Include 320px widths, long URLs, keyboard focus, reduced motion, cached scans, direct report links and a standalone report opened without hosted assets. Rebuild after changing templates or CSS before inspecting the development server.

## How the build works

`scripts/build-assets.mjs` runs the Tailwind CLI over `src/theme.css` with `tailwind.config.ts`, whose content globs cover this package, `packages/core/src/reporters` and `apps/web/src`, and writes the result to `src/generated/theme-css.ts`; it also copies the listed icons from `lucide-static` into `src/generated/icons.ts`. `tsc` then compiles `src/` to `dist/`. The generated folder is ignored by git; turbo's inputs for this package include the scanned sources so the cached stylesheet follows template changes.

## Rules

- Write class names as complete literals in the three scanned places. A class assembled by concatenation is not compiled. Variants go through cva.
- Tokens live in `src/theme.css` as HSL triplets under the standard's names (`--background`, `--primary`, `--ring`, ...). Change values there; do not introduce colours in templates.
- Dark is the default theme: `<html data-theme="dark">`, with `[data-theme="dark"]` carrying the dark token set and Tailwind's `dark:` variant bound to the same attribute.
- Adding an icon: add its lucide name to `ICONS` in the build script and use `icon('name')`.
