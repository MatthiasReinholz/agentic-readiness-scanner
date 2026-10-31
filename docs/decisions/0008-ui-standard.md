# 0008 UI standard: Tailwind and the token contract, without the app framework

Date: 2026-10-31. Status: accepted.

## Context

The maintainer's other TypeScript projects are built on an internal foundation (app-base) that standardizes UI on Tailwind CSS with the shadcn token contract (HSL design tokens in CSS variables, "new-york" component recipes), `cn` from clsx and tailwind-merge, class-variance-authority for variants, lucide icons and Inter. Its components are React on Base UI primitives inside a Next.js app shell.

This project has no client-side framework. The hosted app renders HTML strings from Hono handlers, and the same report renderer writes a standalone HTML file for the CLI. Adding React, Next.js and a primitives library to render a form, a report and three message pages would be the overengineering the project rules exclude, and it would make the standalone report depend on a bundler.

## Decision

- Adopt the framework layer of the standard: Tailwind CSS 3.4 with the same configuration shape, the same token names and HSL-triplet convention, `cn`, cva variants, lucide icons and self-hosted Inter. Token values are this project's: a bright blue primary in both themes and `success` / `warning` added for verdicts.
- Do not adopt the application layer: no React, Next.js, Base UI, `@app/ui` package, AppShell, command palette or keyboard-shortcut registry. Markup stays server-rendered strings; behaviour stays in the few static inline scripts the pages already had.
- `packages/ui` is the one place for the visual system, mirroring the standard's ownership split: tokens and Tailwind config, the compiled stylesheet as a string, class recipes transcribed from the standard's primitives, the icons and the font faces. Core's report renderer and the hosted pages compose from it; neither writes CSS.
- The stylesheet is compiled at build time from the recipes, the report renderer and the hosted pages (Tailwind content globs), then inlined into every document, so the CLI's report remains one self-contained file. Icons are copied from `lucide-static` at build time into a generated module; the worker bundle carries only the icons used.

## Consequences

- Class names must be complete literals in `packages/ui/src`, `packages/core/src/reporters` and `apps/web/src`; a class built by string concatenation is not compiled. Variants go through cva.
- `packages/ui` builds before core and web; its build inputs include their sources so the cached stylesheet is invalidated by template changes.
- Dark remains the default theme (`data-theme` on `<html>`, remembered per browser); Tailwind's `dark:` variant follows the same attribute.
- The hosted app serves the latin subset of Inter (400 to 700) under `/fonts`; the standalone report falls back along the font stack.
