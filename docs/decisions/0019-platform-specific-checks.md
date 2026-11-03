# 0019. The scanner recognises 13 platforms and runs checks for the one it finds

Date: 2026-11-03. Status: accepted.

## Context

The scanner recognised WooCommerce, Shopify and plain WordPress. Checks bound to one of them never ran elsewhere, but reports said so in a sentence such as "2 Shopify check(s) left out, because the scan detected WooCommerce", which drew attention to checks that had nothing to do with the store. Stores on every other platform were "unknown" and got only the general checks, although most platforms have their own interfaces and settings that decide whether agents can read and buy.

## Decision

**Thirteen platforms.** WordPress, WooCommerce, Shopify, BigCommerce and Wix were asked for. The other eight were chosen by live-store counts in the United States and Europe (Store Leads, updated 2026-10-30; the EHI E-Commerce report for Germany's top shops) and by whether the platform documents anything a check can cite: Adobe Commerce / Magento, Squarespace, Square Online, PrestaShop, Salesforce Commerce Cloud, Shopware, Ecwid and Webflow. GoDaddy's builder has more stores than Webflow but documents nothing a public check could rest on, so Webflow, which documents bot controls for agents, took the place. commercetools is headless and cannot be recognised from a page. Fingerprints live in `packages/core/src/target/platforms.ts`; store platforms are tried before site builders, so an Ecwid store embedded in WordPress is an Ecwid store and WooCommerce wins over WordPress.

**Two kinds of platform check, both backed by the platform's own documentation.** A check either reads an interface only that platform has (the WordPress REST API, the Wix site MCP server, BigCommerce's Storefront MCP, Adobe Commerce GraphQL over GET, Shopware's agentic files), or reads the public trace of a platform setting and names the setting (WordPress's search engine visibility, Squarespace's AI crawler box, Webflow's Traffic control, Square Online's hidden-from-search option, Salesforce's staging robots.txt preset, PrestaShop's Friendly URL, Ecwid's clean URLs). Every platform has at least one; WooCommerce and Shopify keep theirs. Setting checks are weight 1, because the general checks already score the symptom and these add the cause; interface checks are weight 1 or 2. None gates a level or lifts a score ceiling: the gates and ceilings name capabilities, not platforms.

**Reports name the platform and leave the rest out.** Every report opens with the recognised platform and the platform checks that ran, tags those checks with the platform's name, and never mentions checks for other platforms. A WordPress check also runs on WooCommerce. Platform advice in fixes (`## On <platform>` sections) covers all 13. The JSON result keeps every check, as the contract requires, with "requires X, which was not detected" on the ones that did not run.

**The contract widens.** `target.platform` gains the new values and the schema id stays `agentic-readiness-scanner/1`: the field has always carried `unknown` for "not one we recognise", and the contract now says the set grows and that a consumer treats a value it does not know as `unknown`. Every consumer this repository ships (reporters, hosted app, CLI, MCP) reads the list from the catalog.

## Alternatives considered

- **Platform checks as a new section.** It would put WordPress REST access next to Webflow bot settings and give the section a score that means different things per platform. Each check sits in the section its subject belongs to instead.
- **Probing APIs with keys the page carries** (BigCommerce's storefront token, Salesforce's public client id, Shopware's access key). The scanner sends no credentials, published or not, and BigCommerce's GraphQL is POST-only.
- **Bumping the schema id for the new enum values.** It would break every stored result for a change that leaves each existing value's meaning intact.

## Consequences

Catalog 0.7.0 with 76 checks, scoring 0.7.0. Scanning one live store per platform showed two defects outside the checks, both fixed here: PrestaShop answers a page request whose Accept header names JSON with an empty body (the scanner's default Accept now matches a browser's), and a score cap held when its gate could not be evaluated at all (a cap now needs a failed or warned gate check; the level still waits for evidence). Stores on the eight new platforms get a named platform, its checks and platform advice in every fix brief; their scores move only by the weight-1 and weight-2 checks above. Fingerprints are observed, not documented by the vendors, and are matched loosely; a headless storefront still shows as unknown or as the platform whose assets it loads.
