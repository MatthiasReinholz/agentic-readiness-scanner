# 0008 UI standard: Tailwind and the token contract, without the app framework

Date: 2026-10-31. Status: accepted.

## Context

The maintainer's other TypeScript projects build on an internal foundation, app-base. It standardises the UI on these parts:

- Tailwind CSS with the shadcn token contract: HSL design tokens in CSS variables, and the "new-york" component recipes.
- `cn` (built on clsx and tailwind-merge) to join class names, and class-variance-authority (cva) for variants.
- lucide icons and the Inter font.
- React components on Base UI primitives, inside a Next.js app shell.

This project has no client-side framework. The hosted app renders HTML strings from Hono handlers, and the same report renderer writes a standalone HTML file for the CLI. Adding React, Next.js and a primitives library to render a form, a report and three message pages would be the overengineering the project rules exclude. It would also make the standalone report depend on a bundler.

## Decision

- Adopt the framework layer of the standard: Tailwind CSS 3.4 with the same configuration shape, the same token names and HSL-triplet convention, `cn`, cva variants, lucide icons and self-hosted Inter. The token values are this project's own: a bright blue primary in both themes, plus `success` and `warning` for verdicts.
- Do not adopt the application layer: no React, Next.js, Base UI, `@app/ui` package, AppShell, command palette or keyboard-shortcut registry. Markup stays server-rendered strings. Behaviour stays in the few static inline scripts the pages already had.
- `packages/ui` is the one place for the visual system, mirroring the standard's ownership split. It holds the tokens and Tailwind config, the compiled stylesheet as a string, class recipes transcribed from the standard's primitives, the icons and the font faces. Core's report renderer and the hosted pages compose from it. Neither writes CSS.
- The stylesheet is compiled at build time from the recipes, the report renderer and the hosted pages (Tailwind content globs), then inlined into every document. The CLI's report therefore stays one self-contained file. Icons are copied from `lucide-static` at build time into a generated module, so the worker bundle carries only the icons it uses.

## Consequences

- Class names must be complete literals in `packages/ui/src`, `packages/core/src/reporters` and `apps/web/src`. Tailwind does not compile a class built by string concatenation. Variants go through cva.
- `packages/ui` builds before core and web. Its build inputs include their sources, so a template change invalidates the cached stylesheet.
- Dark stays the default theme (`data-theme` on `<html>`, remembered per browser). Tailwind's `dark:` variant follows the same attribute.
- The hosted app serves the latin subset of Inter (weights 400 to 700) under `/fonts`. The standalone report falls back along the font stack.
