# 0019 The scanner recognises 13 platforms and runs checks for the one it finds

Date: 2026-11-03. Status: accepted.

## Context

A platform is the software a store or site runs on, such as Shopify or WooCommerce. The scanner recognised WooCommerce, Shopify and plain WordPress. Checks bound to one of them never ran elsewhere, but reports said so in a sentence such as "2 Shopify check(s) left out, because the scan detected WooCommerce". That drew attention to checks that had nothing to do with the store. Stores on every other platform were "unknown" and got only the general checks, although most platforms have their own interfaces and settings that decide whether agents can read and buy.

## Decision

**Thirteen platforms.** WordPress, WooCommerce, Shopify, BigCommerce and Wix were asked for. The other 8 were chosen by two criteria: live-store counts in the United States and Europe (Store Leads data updated 2026-10-30, and the EHI E-Commerce report for Germany's top shops), and whether the platform documents anything a check can cite. They are Adobe Commerce (Magento), Squarespace, Square Online, PrestaShop, Salesforce Commerce Cloud, Shopware, Ecwid and Webflow.

GoDaddy's builder has more stores than Webflow but documents nothing a public check could rest on. Webflow, which documents bot controls for agents, took the place. commercetools is headless (it has no storefront of its own) and cannot be recognised from a page.

Fingerprints live in `packages/core/src/target/platforms.ts`. Store platforms are tried before site builders, so an Ecwid store embedded in WordPress is an Ecwid store, and WooCommerce wins over WordPress.

**Two kinds of platform check, both backed by the platform's own documentation.**

- An interface check reads an interface only that platform has: the WordPress REST API, the Wix site MCP server, BigCommerce's Storefront MCP, Adobe Commerce GraphQL over GET, Shopware's agentic files.
- A setting check reads the public trace of a platform setting and names the setting: WordPress's search engine visibility, Squarespace's AI crawler box, Webflow's Traffic control, Square Online's hidden-from-search option, Salesforce's staging robots.txt preset, PrestaShop's Friendly URL, Ecwid's clean URLs.

Every platform has at least one check. WooCommerce and Shopify keep theirs. Setting checks are weight 1, because the general checks already score the symptom and these add the cause. Interface checks are weight 1 or 2.

None of the 12 checks added here (A2.8 to A2.12, A3.12, A3.13, A4.7 to A4.9, B1.9, B5.9) gates a level or lifts a score ceiling, because the gates and ceilings name capabilities, not platforms. The older WooCommerce and Shopify checks keep their roles: B1.2 and B1.8 are alternatives in the Level 2 gate, and B5.8 is an alternative in the Level 2 and Level 5 gates and in the `no-checkout` ceiling.

**Reports name the platform and leave the rest out.** Every report opens with the recognised platform and the platform checks that ran, and tags those checks with the platform's name. It never mentions checks for other platforms. A WordPress check also runs on WooCommerce. Platform advice in fixes (`## On <platform>` sections) covers all 13 platforms. The JSON result keeps every check, as the contract requires, with "requires X, which was not detected" on the ones that did not run.

**The contract widens.** `target.platform` gains the new values, and the schema id stays `agentic-readiness-scanner/1`. The field has always carried `unknown` for "not one we recognise". The contract now says that the set grows and that a consumer treats a value it does not know as `unknown`. Every consumer this repository ships (reporters, hosted app, CLI, MCP server) reads the list from the catalog.

## Alternatives considered

- **Platform checks as a new section.** It would put WordPress REST access next to Webflow bot settings and give the section a score that means different things per platform. Each check sits in the section its subject belongs to instead.
- **Probing APIs with keys the page carries** (BigCommerce's storefront token, Salesforce's public client id, Shopware's access key). The scanner sends no credentials, published or not, and BigCommerce's GraphQL is POST-only.
- **Bumping the schema id for the new enum values.** It would break every stored result for a change that leaves each existing value's meaning intact.

## Consequences

This is catalog 0.7.0 with 76 checks, and scoring 0.7.0.

Scanning one live store per platform showed two defects outside the checks. Both are fixed here:

- PrestaShop answers a page request whose Accept header names JSON with an empty body. The scanner's default Accept header now matches a browser's.
- A score cap held when its gate could not be evaluated at all. A cap now needs a gate check that failed or warned. The level still waits for evidence.

Stores on the 8 new platforms get a named platform, its checks, and platform advice in every fix brief. Their scores move only by the weight-1 and weight-2 checks above. Fingerprints are observed, not documented by the vendors, and are matched loosely. A headless storefront still shows as unknown, or as the platform whose assets it loads.
