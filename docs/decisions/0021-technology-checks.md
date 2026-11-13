# 0021 Technology checks record how a store is built on its platform, never scored

Date: 2026-11-13. Status: accepted. Extends [0019](0019-platform-specific-checks.md).

## Context

Decision 0019 made the scanner recognise 13 platforms and run checks for the platform it finds. It answered "which platform" and nothing more. Two stores on the same platform can still be built very differently, and the difference decides where a fix goes and what an agent meets:

- A WordPress site can run a block theme, a classic theme or a headless front end that only reads WordPress for its content, and many run a page builder on top.
- A WooCommerce store's cart and checkout can be the Cart and Checkout blocks, which build the form in the browser, or the classic shortcodes, which render it on the server.
- A Shopify store can run an Online Store theme or a headless storefront such as Hydrogen; a BigCommerce store a Stencil theme or Catalyst; an Adobe Commerce store a Luma-based theme, Hyvä or a headless front end; a Salesforce store SFRA or the Composable Storefront built with PWA Kit.

Merchants and the agencies that work for them asked to see these choices in the report. None of them makes a store better or worse for agents by itself: what agents need (complete HTML, structured data, an API to buy through) is scored by the checks that already exist.

## Decision

**A technology check is a platform check that records a choice.** The catalog marks it with `technology: true`. The validator enforces weight `info` and a platform requirement, so a technology check is never scored, never gates a level or lifts a ceiling, and runs only on its platform.

**Facts, not verdicts.** A technology check passes whenever it could read what it needs and lists its findings as `evidence.facts`, an array of `{ label, value }` pairs such as `{ "label": "Checkout", "value": "Checkout block" }` (`TechnologyFactSchema` in the result contract). A fact the pages do not show is left out, never guessed. When nothing could be read, the check is skipped with reason `error`, which costs nothing because its weight is `info`.

**Reports show the facts next to the platform.** The HTML report adds one chip per fact beside the platform chip, each linking to its check. The Markdown report adds a "Built with" line under the platform line. Both read the facts through `technologyFacts` in `reporters/shared.ts`, which accepts only passing technology checks and only facts of the documented shape, so older results render without them.

**What the checks read.** Every signal is written by the platform itself and documented in its source or docs, and each article cites them:

- **A3.15 WordPress theme type:** the `wp-site-blocks` element that WordPress's block template canvas prints, WooCommerce's `currentThemeIsFSETheme` setting when present, the `wp-theme-` and `wp-child-theme-` body classes (WordPress 6.8 and later) or the theme folder, page builders by body class or asset folder, and a JavaScript framework's own markers for a headless front end. No extra request.
- **B5.12 WooCommerce cart and checkout type:** the cart page as served (`wp-block-woocommerce-cart` against the shortcode's `wc-empty-cart-message`), and through the WordPress REST API the content of the checkout page, because WooCommerce redirects the checkout to the cart while the cart is empty and many stores keep both pages out of robots.txt. At most four requests.
- **A3.16 Shopify storefront type:** the `Shopify.theme` object that `content_for_header` prints (theme name, version, and the Theme Store id Shopify sets for its own Theme Store themes), Hydrogen's `powered-by` header, and a front-end framework on a domain Shopify does not serve.
- **A3.17 BigCommerce storefront type:** the `stencilBootstrap` script every Stencil theme calls, else Next.js (the stack of Catalyst) or another framework. The `/stencil/` segment in BigCommerce image URLs does not count, because headless storefronts load the same images.
- **A3.18 Adobe Commerce storefront type:** the theme's static asset path, Hyvä's `Hyva/` path or `window.hyva` object, RequireJS and `text/x-magento-init` for Luma-based themes, else a front-end framework.
- **A3.19 Salesforce storefront type:** PWA Kit's `/mobify/bundle/` path for the Composable Storefront, else `/on/demandware.static/` for SFRA or SiteGenesis, which the page cannot tell apart.

The storefront checks make no extra request. Platforms whose pages show no comparable choice (Wix, Squarespace, Square Online, Webflow, Ecwid, PrestaShop, Shopware) get no technology check: their storefront is the platform's own, or the difference left no reliable trace on the page.

**One fingerprint more.** The Composable Storefront loads none of B2C Commerce's own asset paths, so it was recognised as unknown and its Salesforce checks never ran. `/mobify/bundle/`, which PWA Kit's runtime defines as its bundle path, now recognises Salesforce Commerce Cloud too.

**The result contract widens without a new schema id.** `technology` is a new optional catalog field with a default, and `evidence` was always check-specific. Consumers that ignore both are unaffected.

## Alternatives considered

- **A separate technology block in the result**, like `legal`. It would need its own runner and renderers, and lose what checks already have: a catalog entry with sources, a knowledge-base article, a place in the JSON result and the MCP tools.
- **Scoring the choices**, for example marking the block checkout down because an HTML-only agent sees no form. Agents that buy use the Store API, which both kinds of checkout leave in place, so the score would punish a choice that does not change what agents can do.
- **Detecting the checkout type from the checkout page.** It redirects to the cart while the cart is empty, for the block and the shortcode alike (`wc_template_redirect`), and the scanner never adds products to a cart.

## Consequences

This is catalog 0.14.0. The scoring version is unchanged, because no technology check carries weight.

The cart and checkout check reads the REST API, so it inherits that interface's limits: a site that refuses anonymous REST reads, or disallows `/wp-json/` in robots.txt, keeps its checkout type unknown, and the message says so. A classic checkout whose content is rendered by a template or plugin shows empty content through the REST API and also stays unknown.

Under a tight request budget, informational checks run last, so B5.12 can be skipped as `budget_exhausted` on a large store.
