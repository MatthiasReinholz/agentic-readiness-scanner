# 0010 The scanner identifies itself on every request and never impersonates an agent

Date: 2026-10-31. Status: accepted.
Revisited in [0020](0020-crawler-registry.md) on 2026-11-10, with the rule kept: a spoofed request would also pollute the owner's AI crawler analytics.

## Context

Bot management is the layer in front of many stores (Cloudflare, DataDome and similar) that decides which automated clients it lets through. Most readiness scanners test it by fetching a page under the user-agent strings (the name a client sends to identify itself) of GPTBot, ClaudeBot, PerplexityBot and others, and comparing the answers with a browser fetch. The first catalog planned the same for A2.4: fetch one product page with up to six agent user-agent strings.

Three arguments speak against it:

1. It is impersonation, and the project promises honest behaviour toward the sites it scans.
2. The large crawlers are verified by published IP ranges or by signed requests. To a bot-management product, a spoofed GPTBot from an unknown address is an attacker. The probe measures the spoof-protection path, not what GPTBot experiences, and it produces false blocks on well-configured sites.
3. The scanner's own honest fetch already shows what matters: what an agent that is not on an allow list meets.

## Decision

- Every request the scanner makes carries `AgenticReadinessScanner/<version> (+repository URL)`. No request carries another product's token.
- A2.4 classifies the responses the scan already received under that identity: the home page, robots.txt (the file that tells crawlers what they may fetch), sampled product pages and policy pages. It looks for:
  - bot-management challenge markers: `cf-mitigated` and `x-vercel-mitigated: challenge`, DataDome captcha pages, and challenge pages served with status 200,
  - refusal statuses: 401, 402, 403, 406, 429 and 451,
  - redirects to consent or region interstitials.

  It names the product behind a refusal when the response does. A block on the home page, robots.txt or a product page fails the check. A refused policy page alone is a note on a pass, because a login wall in front of a support form does not make the store unreachable. B4.6 reports what the agent cannot read there. A refused home page still yields a Level 0 report ([0012](0012-priorities-and-honest-non-answers.md)). The check's message states that verified crawlers may be let through.

- The resolver (the part of the engine that finds the pages to check) never picks a policy page from the account, login, cart or checkout areas. Those answer with login walls by design.
- robots.txt is evaluated offline for every documented crawler token, from the file itself. That needs no impersonation (A2.1, A2.2, A2.5, B4.6).
- The security model and the hosted app's `llms.txt` describe this behaviour.

## Consequences

- The scanner cannot tell a store that blocks GPTBot by user agent from one that does not. The catalog says so instead of guessing: crawlers verified by published IP ranges or signed requests may be let through.
- Sites that challenge every unverified client fail Level 1. That is the honest reading: such a site is unreachable for any agent that is not on an allow list.
- If the scanner one day signs its own requests under Web Bot Auth (a proposed standard for signed bot requests), a store can verify it like any other agent. That is infrastructure work, not a catalog change.
