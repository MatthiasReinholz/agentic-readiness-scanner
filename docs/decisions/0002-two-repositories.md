# 0002 The WordPress plugin lives in its own repository

Date: 2026-10-30. Status: accepted.

## Context

wp-plugin-base, the foundation for the maintainer's WordPress plugins, manages root files (`.gitignore`, `.editorconfig`, `CONTRIBUTING.md`, workflows, CODEOWNERS), assumes the main plugin file at the repository root, packages a ZIP from the root, and deploys to WordPress.org on its own release cadence with a PHP toolchain. This repository is a pnpm and turbo workspace with its own root files, CI contract and npm and Spacefast release cadence.

## Decision

The scanner (catalog, engine, CLI, MCP, hosted app) lives here. The plugin lives in a separate repository as a wp-plugin-base child. The contract between them is the catalog data file and the result schema attached to every release here; see [companion-plugin.md](../companion-plugin.md).

## Consequences

- Each repository keeps one foundation, one toolchain and one release flow.
- The plugin pins a catalog version; catalog releases that add checks are compatible, result schema changes need a plugin release.
