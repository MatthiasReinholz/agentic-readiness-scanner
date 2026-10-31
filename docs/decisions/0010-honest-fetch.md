# 0010 The scanner identifies itself on every request and never impersonates an agent

Date: 2026-10-31. Status: accepted.

## Context

Most readiness scanners test bot-management behaviour by fetching a page under the user-agent strings of GPTBot, ClaudeBot, PerplexityBot and others and comparing the answers with a browser fetch. The first catalog planned the same (A2.4, "fetch one product page with up to six agent user-agent strings").

Three things speak against it. It is impersonation, and the project promises honest behaviour toward targets. The large crawlers are verified by published IP ranges or by signed requests, so a spoofed GPTBot from an unknown address is, to a bot-management product, an attacker: the probe measures the spoof-protection path, not what GPTBot experiences, and produces false blocks on well-configured sites. And a scanner's own honest fetch already shows what matters: what an agent that is not on an allow list meets.

## Decision

- Every request the scanner makes carries `AgenticReadinessScanner/<version> (+repository URL)`. No request carries another product token.
- A2.4 classifies the responses the scan already made with that identity (home page, robots.txt, sampled product pages, policy pages): bot-management challenge markers (`cf-mitigated: challenge`, challenge pages served as 200), refusal statuses (402, 403, 429, 451) and redirects to consent or region interstitials. Its message states that verified crawlers may be treated differently.
- robots.txt is evaluated for every documented crawler token offline, from the file, which needs no impersonation (A2.1, A2.2, A2.5, B4.6).
- The security model and the hosted app's `llms.txt` describe this behaviour.

## Consequences

- The scanner cannot tell a store that blocks GPTBot by user agent from one that does not. It says so in the catalog ("verified crawlers … may be treated differently") rather than guessing.
- Sites that challenge every unverified client fail Level 1, which is the honest reading: such a site is unreachable for any agent that is not on an allow list.
- When the scanner signs its own requests under Web Bot Auth one day, a store can verify it like any other agent; that is infrastructure work, not a catalog change.
