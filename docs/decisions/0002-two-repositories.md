# 0002 The WordPress plugin lives in its own repository

Date: 2026-10-30. Status: superseded by [0007](0007-no-companion-plugin.md), which drops the plugin.

## Context

At the time, the scanner was to have a companion WordPress plugin ([0001](0001-typescript-core.md)). The question was whether both should live in one repository.

wp-plugin-base is the foundation for the maintainer's WordPress plugins. It manages the root files (`.gitignore`, `.editorconfig`, `CONTRIBUTING.md`, workflows, CODEOWNERS), expects the main plugin file at the repository root, packages a ZIP from the root, and deploys to WordPress.org on its own release cadence with a PHP toolchain. This repository is a pnpm and turbo workspace (one repository with several packages) with its own root files, CI contract and release cadence for npm and Spacefast. One repository cannot follow both foundations.

## Decision

The scanner (catalog, engine, CLI, MCP server, hosted app) lives here. The plugin lives in a separate repository as a child of wp-plugin-base. The contract between the two is the catalog data file and the result schema, attached to every release of this repository.

## Consequences

- Each repository keeps one foundation, one toolchain and one release flow.
- The plugin pins a catalog version. Catalog releases that add checks stay compatible. Changes to the result schema need a plugin release.
