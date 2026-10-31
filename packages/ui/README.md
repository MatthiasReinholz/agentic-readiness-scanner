# @agentic-readiness/ui

The visual system shared by the HTML report (`@agentic-readiness/core`) and the hosted app (`apps/web`). It follows the framework layer of the app-base UI standard and nothing above it: Tailwind CSS with the shadcn token contract, class recipes transcribed from its primitives, lucide icons and self-hosted Inter. No React, no component runtime; everything is a string for server-rendered HTML. See [decision 0008](../../docs/decisions/0008-ui-standard.md).

## What it exports

- `THEME_CSS`: the compiled, minified stylesheet. `htmlDocument` in core inlines it, so a report written by the CLI is one self-contained file.
- Recipes (`src/recipes.ts`): `button({ variant, size })`, `badge({ variant })`, `card` and its parts, `input`, `nativeSelect` with wrapper and chevron, `textarea`, `label`, `alert({ variant })`, `separator`, `codeInline`, `codeBlock`, and `cn` for merging class lists.
- `icon(name, className?)`: an inline lucide SVG; the names are listed in `scripts/build-assets.mjs`.
- `interFontFaceCss(baseUrl)` and `FONT_FILES` for the self-hosted font faces the hosted app serves under `/fonts`.

## How the build works

`scripts/build-assets.mjs` runs the Tailwind CLI over `src/theme.css` with `tailwind.config.ts`, whose content globs cover this package, `packages/core/src/reporters` and `apps/web/src`, and writes the result to `src/generated/theme-css.ts`; it also copies the listed icons from `lucide-static` into `src/generated/icons.ts`. `tsc` then compiles `src/` to `dist/`. The generated folder is ignored by git; turbo's inputs for this package include the scanned sources so the cached stylesheet follows template changes.

## Rules

- Write class names as complete literals in the three scanned places. A class assembled by concatenation is not compiled. Variants go through cva.
- Tokens live in `src/theme.css` as HSL triplets under the standard's names (`--background`, `--primary`, `--ring`, ...). Change values there; do not introduce colours in templates.
- Dark is the default theme: `<html data-theme="dark">`, with `[data-theme="dark"]` carrying the dark token set and Tailwind's `dark:` variant bound to the same attribute.
- Adding an icon: add its lucide name to `ICONS` in the build script and use `icon('name')`.
