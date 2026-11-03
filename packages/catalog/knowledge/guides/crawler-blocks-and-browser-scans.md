---
slug: crawler-blocks-and-browser-scans
headline: Why the scanner reports crawler blocks instead of scanning from your browser
description: Why a store that blocks honest crawlers is reported as unreachable, why a web page cannot scan another site from your browser, and how to let the scanner in.
keywords: crawler blocked, bot protection AI agents, Cloudflare blocks scanner, scan from browser, CORS, same-origin policy, allow AI agents
related: A2.4, A2.5, A2.2, A1.1
---

## In short

The scanner fetches a store from a server and says who it is in every request. When the store's bot protection refuses that honest request, the report says so and the store gets Level 0: an AI agent that is not on an allow list meets the same wall. Scanning from the visitor's browser instead is not possible for a web page, because browsers do not let one site read another site's pages.

## How the scanner fetches a store

Every request carries the user agent `AgenticReadinessScanner` with a link to its documentation. The scanner reads robots.txt first and respects it, sends its requests one after another with a pause between them, and stops at a fixed request budget. On the hosted app a scan runs in short steps on the server until it is done, and each site can be scanned at most once a minute.

The scanner never pretends to be a browser or a known crawler. What it receives is what any agent that identifies itself honestly receives.

## Why a crawler block is a finding

Many stores sit behind bot protection from their host or a security service. Some of it refuses every client it cannot verify: it answers 403 Forbidden, 429 Too Many Requests or a challenge page instead of the store. The scanner treats such answers on the home page, robots.txt or a product page as a block, and names the product behind it when the response does (Cloudflare, Akamai, DataDome, Vercel, Imperva, HUMAN, AWS WAF).

A block is reported, not worked around, for three reasons:

- It is what an agent meets. An assistant that fetches a product page because a person asked it to is an unverified client too. If the store refuses the scanner, it most likely refuses that assistant.
- It is the most important result in the report. A store that cannot be read cannot be recommended or bought from, whatever its markup says.
- Getting past it by disguise would make the rest of the report untrue. A scan that looks like a browser measures what browsers get, not what agents get.

So the report for a blocked store fails [check A2.4](/knowledge-base/no-block-on-honest-fetch), still reads robots.txt and the sitemap where they answer, and marks every check that needs the pages as not evaluated rather than guessing. Big search and AI crawlers may still be let through, because services can verify them by published IP ranges or signed requests. The report says that too.

## Why the scanner cannot scan from your browser

It would seem natural to run the scan in the visitor's browser: a real browser, with its own address, and no load on the scanner's server. Browsers do not allow it, and for a good reason.

### Reading another site is blocked by design

Under the same-origin policy, a script on one site can send a request to another site but cannot read the answer, unless the other site allows it with Cross-Origin Resource Sharing (CORS) headers. Without that permission the browser hands the script an error, or with the `no-cors` mode an opaque response with no status and no body. This is what stops any page you open from reading your webmail or your bank in the background with your login.

Stores do not send CORS permission for their pages, robots.txt or sitemaps. When we tested this from the hosted app on 3 November 2026, every one of them was unreadable. Only a few APIs that opt in on purpose could be read, such as the WordPress REST API index, Shopify's `products.json` and a published commerce profile. A scan needs far more than those.

### Iframes and windows do not help

A page can show another site in an iframe or open it in a window, but its scripts cannot look inside: the browser keeps a cross-origin document out of reach. Many stores also forbid being framed at all, with the `X-Frame-Options` header or the `frame-ancestors` rule of their Content Security Policy.

### What would work, and why the scanner does not use it

Two things can read other sites from a browser, and both need the visitor to act. A browser extension may read the sites its user allows it to, once it is installed. A bookmarklet runs inside the store's own tab, once the visitor opens the store and clicks it. A third option, loading the store through the scanner's own address, only moves the fetching back to the server.

There is a second problem. A result computed in someone's browser is whatever that browser sends. Accepted as a store's profile, it would let anyone publish made-up results for a site.

## What store owners can do

If your store blocks the scanner and you want a full report, let it through at the edge for the time of a scan. On Cloudflare, a custom rule with the Skip action can match the user agent `AgenticReadinessScanner` and skip Super Bot Fight Mode and the managed rules. Bot Fight Mode on the Free plan cannot be skipped: it has to be switched off for a scan to get through. Other services have equivalent allow rules.

A rule that trusts a user agent also lets in anything that copies the string, so keep it narrow and temporary. The lasting question is a different one: which agents should reach your products. Read how to [let user-directed assistants fetch your pages](/knowledge-base/user-triggered-fetchers-allowed) and how to [allow the crawlers behind AI answers](/knowledge-base/search-and-assistant-crawlers-allowed) in robots.txt, then check whether your bot protection agrees with what your robots.txt says.

## FAQ

### Why does my store get Level 0 when it works fine in my browser?

Your browser passes the bot protection's checks; an honest automated client does not. Level 0 says that agents cannot read the store, which is true for every agent the protection does not verify.

### Can the scanner use my browser so that the block does not matter?

No. A web page cannot read another site's pages from your browser unless that site allows it, and stores do not. It would take a browser extension or a bookmarklet, and a result computed in a browser could not be trusted as the store's profile.

### Will the scanner ever pretend to be a browser to get past a block?

No. A disguised scan would report what browsers see, not what agents see, and it would ignore the store's decision to refuse automated clients.

### Is it safe to allow the scanner's user agent in my firewall?

For a short time, yes, but a user-agent rule lets in anything that sends the same string. Keep the rule narrow and remove it after the scan.

## Sources

- [MDN: Same-origin policy](https://developer.mozilla.org/en-US/docs/Web/Security/Defenses/Same-origin_policy)
- [MDN: Cross-Origin Resource Sharing (CORS)](https://developer.mozilla.org/en-US/docs/Web/HTTP/Guides/CORS)
- [WHATWG Fetch Standard: the CORS protocol](https://fetch.spec.whatwg.org/#http-cors-protocol)
- [MDN: X-Frame-Options](https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/X-Frame-Options)
- [MDN: CSP frame-ancestors](https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/Content-Security-Policy/frame-ancestors)
- [Chrome for Developers: cross-origin network requests in extensions](https://developer.chrome.com/docs/extensions/develop/concepts/network-requests)
- [Cloudflare: verified bots](https://developers.cloudflare.com/bots/concepts/bot/verified-bots/)
- [Cloudflare: Web Bot Auth](https://developers.cloudflare.com/bots/reference/bot-verification/web-bot-auth/)
- [Cloudflare: skip options in custom rules](https://developers.cloudflare.com/waf/custom-rules/skip/)
- [RFC 9309: Robots Exclusion Protocol](https://www.rfc-editor.org/rfc/rfc9309)
