# 0007 There is no companion plugin

Date: 2026-10-31. Status: accepted. Supersedes [0002](0002-two-repositories.md) and the plugin statements in [0001](0001-typescript-core.md).
Amended by [0019](0019-platform-specific-checks.md): a fix may now carry `## On <platform>` notes that reach a report only on that platform, so platform advice no longer has to sit inside the platform-neutral brief.

## Context

The original plan paired the scanner with a WordPress plugin. The plugin would read the public report, audit the full catalog from inside the store, and apply the mechanical fixes in one click. None of it was built. Still, the repository carried the promise in several places: the README, a contract document, two decision records, a configuration variable, a link on every WooCommerce report, and the meaning of the `auto_fix` flag on each fix.

The maintainer decided not to build it. The scanner's value is the public, platform-neutral view and the fix briefs. Applying fixes inside a store is the job of the merchant's own tooling, or of a coding agent working from the brief.

## Decision

- No companion plugin, no plugin repository, no plugin contract. All references are removed.
- `auto_fix` stays in the catalog and the result contract with a new meaning: the fix is mechanical. That is a file, setting or markup change that a tool or agent can apply from the store's existing data, without product knowledge or copywriting. Reports and docs label it "mechanical". Keeping the field avoids a breaking change to the result schema `agentic-readiness-scanner/1` for one boolean, and the distinction stays useful to anyone automating fixes from the briefs.
- A brief for a coding agent may mention WordPress or WooCommerce specifics only as a clause inside platform-neutral instructions, because every brief is shown on every platform.

## Consequences

- The published artefacts (`catalog.json`, the JSON Schemas, the result contract) remain the integration surface for any external tool, in any language.
- The roadmap's 1.0 milestone becomes "full catalog implemented, result contract declared stable".
