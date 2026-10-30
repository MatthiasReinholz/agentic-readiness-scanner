# Companion plugin contract

The WordPress companion plugin lives in its own repository, built on [wp-plugin-base](https://github.com/MatthiasReinholz/wp-plugin-base). This page defines what it consumes from this repository and what it adds, so the two can evolve independently.

## Why a separate repository

wp-plugin-base manages root files, assumes the main plugin file at the repository root, packages and deploys to WordPress.org on its own cadence, and runs a PHP toolchain. None of that fits inside a pnpm workspace. See [decision 0002](decisions/0002-two-repositories.md).

## What the plugin consumes

- **The catalog as data.** `catalog-<version>.json` is attached to every GitHub release of this repository (and shipped in the `@agentic-readiness/catalog` npm package). It carries every check with title, question, weight, dependencies, spec URLs and the fix in three forms, plus levels and profiles. The plugin vendors the file at build time and reads it at runtime; it never embeds check text of its own.
- **The result object.** `scan-result.schema.json` is attached to every release. The plugin requests a public scan from a scanner endpoint (the hosted app by default, configurable for self-hosted instances) through `POST /api/scan` and renders the result with the same levels, scores and fixes a merchant sees online.

## What the plugin adds

- **Inside view.** Settings only readable from within WordPress: Store API enabled, guest checkout, permalink structure, which SEO plugin owns Product markup, whether a feed plugin is active.
- **Full-catalog audit.** Product identity checks (B3) over every published product in batches through Action Scheduler, with a worst-first table and CSV export.
- **One-click fixes** for the checks marked `auto_fix: true` in the catalog: llms.txt, robots rules for AI crawlers and shopping agents, Content Signals, Link headers, Markdown negotiation, Product JSON-LD with Offer, ProductGroup, shipping and return details, identifier fields with validation, policy page drafts, security.txt, a UCP manifest that declares only what exists.
- **Scheduled rescans** with score history and an email when the level drops.

## Boundaries

The plugin does not implement UCP or ACP checkout; it declares what exists and points at integrations that provide it. It does not replace a feed or SEO plugin; it detects them and fills gaps. It never sends anything but the store's public URL to the scanner endpoint.

## Compatibility rule

The plugin pins a catalog version and a result schema id. A catalog release that adds checks is backward compatible; a change to the result schema id requires a plugin release. Both are recorded in `CHANGELOG.md` here.
