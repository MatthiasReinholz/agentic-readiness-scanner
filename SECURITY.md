# Security Policy

## Reporting a vulnerability

Do not open a public issue for a suspected vulnerability. Use [GitHub private vulnerability reporting](https://github.com/MatthiasReinholz/agentic-readiness-scanner/security/advisories/new) for this repository. Include the affected component, impact, reproduction steps and any mitigation you already identified. You will get an acknowledgement within a few days.

## Supported versions

The latest tagged release on `main` is supported. Older releases receive no fixes.

## Scope

This repository is responsible for:

- the scanning engine, catalog, CLI and MCP packages (intended for npm; not published yet)
- the hosted application and its deployment workflows
- the GitHub Actions workflows and their supply-chain policy

It does not store or need any credential to scan a store. The hosted deployment is built and served by Spacefast from `main`; its own secrets (mail provider key, admin token) live in Space variables, and the only GitHub secret is the npm token for releases. None live in the repository.

## Threat model of the scanner

Any URL-in service is a server-side request forgery and scraping vector. The controls are described in [docs/security-model.md](docs/security-model.md): URL policy (public hosts, default ports, no private ranges), a fixed request budget per scan, body size caps, redirect limits, per-target cooldown, an honest user agent, and respect for robots.txt on everything except robots.txt, sitemaps and the well-known directory. Changes to these controls are reviewed like privileged infrastructure changes.
