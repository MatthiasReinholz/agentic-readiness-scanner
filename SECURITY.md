# Security Policy

## Reporting a vulnerability

Do not open a public issue for a suspected vulnerability. Use [GitHub private vulnerability reporting](https://github.com/MatthiasReinholz/agentic-readiness-scanner/security/advisories/new) for this repository. Include the affected component, the impact, steps to reproduce and any mitigation you already found. You will get an acknowledgement within a few days.

## Supported versions

The latest tagged release on `main` is supported. Older releases receive no fixes.

## Scope

This repository is responsible for:

- the scanning engine and the CLI with its MCP server, published to npm as `@agentic-readiness/core` and `@agentic-readiness/cli` (the catalog, UI and MCP packages are private and bundled into them)
- the hosted scanner and its deployment
- the GitHub Actions workflows and their supply-chain policy

The scanner does not store or need any credential to scan a store. Spacefast builds and serves the hosted scanner from `main`. Its own secrets (the mail provider key and the admin token) live in Space variables, not in the repository. Releases publish to npm through trusted publishing, so no npm token is stored. A short-lived `NPM_TOKEN` secret is needed only for a package's very first publish and is deleted afterwards ([docs/release-process.md](docs/release-process.md)).

## Threat model of the scanner

Any service that fetches a URL a visitor submits can be abused for server-side request forgery (making the server call internal addresses) and for scraping. [docs/security-model.md](docs/security-model.md) describes the controls:

- a URL policy: public hosts and default ports only, no private address ranges
- a fixed request budget per scan, a body size cap and a redirect limit
- a cooldown per target
- an honest user agent that names the scanner
- robots.txt honoured for the scanner's own user agent on everything except robots.txt, sitemaps and the `/.well-known/` directory

Changes to these controls are reviewed like changes to privileged infrastructure.
