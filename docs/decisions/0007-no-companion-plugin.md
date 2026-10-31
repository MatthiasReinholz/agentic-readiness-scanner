# 0007 There is no companion plugin

Date: 2026-10-31. Status: accepted. Supersedes [0002](0002-two-repositories.md) and the plugin statements in [0001](0001-typescript-core.md).

## Context

The original plan paired the scanner with a WordPress plugin that would read the public report, audit the full catalog from inside the store and apply the mechanical fixes in one click. Nothing of it was built; the repository carried the promise in the README, a contract document, two decision records, a configuration variable, a link on every WooCommerce report and the meaning of the `auto_fix` flag.

The maintainer decided not to build it. The scanner's value is the public, platform-neutral view and the fix briefs; applying fixes inside a store is the job of the merchant's own tooling or a coding agent working from the brief.

## Decision

- No companion plugin, no plugin repository, no plugin contract. All references are removed.
- `auto_fix` stays in the catalog and the result contract with a new meaning: the fix is mechanical, a file, setting or markup change a tool or agent can apply from the store's existing data without product knowledge or copywriting. Reports and docs label it "mechanical". Keeping the field avoids a breaking change to `agentic-readiness-scanner/1` for one boolean, and the distinction remains useful to anyone automating fixes from the briefs.
- Agent briefs may mention WordPress or WooCommerce specifics only as a clause inside platform-neutral instructions, since every brief is shown to every platform.

## Consequences

- The published artefacts (catalog.json, the JSON Schemas, the result contract) remain the integration surface for any external tool, in any language.
- The roadmap's 1.0 milestone becomes "full catalog implemented, result contract declared stable".
