---
slug: ai-crawlers-and-agents
headline: How AI crawlers, assistants and agents reach your site
description: Which AI crawlers, fetchers and browser agents visit a store, what robots.txt controls for each, and how ChatGPT, Claude, Gemini and Grok identify themselves.
keywords: AI crawlers list, GPTBot ClaudeBot PerplexityBot, ChatGPT agent user agent, Grok crawler, Web Bot Auth, AI bots robots.txt, block AI crawlers
related: A2.1, A2.2, A2.4, A2.5, A2.13, A2.14
---

## In short

AI reaches a website in four ways: crawlers that collect training data, crawlers that build the search indexes AI answers draw on, fetchers that open one page because a person asked, and browser agents that operate a site for a person. robots.txt speaks to the first three by name, with different effect for each. Browser agents mostly have no robots.txt name at all, and some assistants, such as Grok, document nothing a site can address. The scanner reads robots.txt against a registry of the names operators document and tells you what it cannot see.

## Four ways AI reaches a site

| Kind               | What it does                                                | Example tokens                                                          | robots.txt                             |
| ------------------ | ----------------------------------------------------------- | ----------------------------------------------------------------------- | -------------------------------------- |
| Training crawler   | Collects pages to train models                              | GPTBot, ClaudeBot, CCBot                                                | Obeyed by the documented ones          |
| Search crawler     | Builds the index that search results and AI answers draw on | {{crawlers:index.core}}, OAI-SearchBot, Claude-SearchBot, PerplexityBot | Obeyed by the documented ones          |
| Fetcher on request | Opens one page because a person asked an assistant about it | ChatGPT-User, Claude-User, Perplexity-User                              | Several operators say it may not apply |
| Browser agent      | Drives a real browser to complete a task for a person       | Google-Agent, Claude-Agent                                              | Rarely addressed                       |

The scanner keeps one registry of {{count:answers}} tokens behind AI answers and {{count:training}} training tokens, each linked to its operator's documentation and dated. The [crawler registry page](/knowledge-base/crawlers) lists them all. A name that appears only in third-party block lists is not in it.

## What robots.txt controls

A crawler follows the group that names its own token, else the `User-agent: *` group. That makes the kinds independent: you can refuse training and stay in AI answers.

- **Training.** Disallowing GPTBot, ClaudeBot or the shared token `__usage_ai-training` is a licensing decision. It costs nothing in search or answers, with one exception: Google documents that Google-Extended also governs grounding in Gemini Apps.
- **Search indexes.** Disallowing {{crawlers:index.core}} removes a site from Google's and Microsoft's AI answers, and from ChatGPT search results that come from Microsoft. Disallowing an assistant's own crawler, such as OAI-SearchBot or Claude-SearchBot, removes it from that assistant.
- **Fetchers on request.** For {{crawlers:fetchers.may-ignore}}, the operators say robots.txt may not apply, because a person asked. {{crawlers:fetchers.honours}} obey it.

Names change. Google renamed its notebook fetcher in July 2026, and many block lists still name anthropic-ai or claude-web, which Anthropic does not document. A group for an outdated name reaches no crawler. The [crawler names check](/knowledge-base/robots-txt-crawler-names-current) finds them.

## Assistants that have no robots.txt name

The newest way AI reaches a store is an agent that browses like a person. A site cannot address most of them in robots.txt:

- **ChatGPT's cloud browser** (formerly ChatGPT agent and Operator) sends an ordinary browser user agent and signs every request with Web Bot Auth, with the signature agent `https://chatgpt.com`. OpenAI's help article lists the setting each bot manager needs to let it through.
- **Claude-Agent** is the browser Anthropic hosts for Claude. It adds the token `Claude-Agent` to a normal browser user agent, and Anthropic publishes its addresses.
- **Google-Agent** browses for agents hosted on Google's infrastructure. Google says user-triggered fetchers generally ignore robots.txt, and signs some of these requests with Web Bot Auth.
- **Grok.** xAI documents no crawler, fetcher, user agent, IP list or robots.txt token. Grok Bot browses on its own cloud computer as the person it works for. A site cannot tell it apart from that person, or address it in robots.txt.
- **Agents in the person's own browser**, such as ChatGPT's built-in browser and Chrome extension or Gemini in Chrome, look like that person. They pass whatever the person passes.

Web Bot Auth is an IETF draft for signed bot requests. The agent signs each request with a key it publishes at `/.well-known/http-message-signatures-directory` on its own domain, and bot managers such as Cloudflare, Akamai, Vercel, AWS WAF and DataDome verify it. A website publishes nothing for it. Your bot manager decides whether signed agents get in.

## What happens at your edge

robots.txt is a request. A CDN or bot manager in front of the site enforces its own rules, and those match user agents. Cloudflare's AI Crawler and Agent access policies, Vercel's AI Bots ruleset and AWS WAF's CategoryAI rule can each refuse training crawlers, search crawlers and agents per category, whatever robots.txt says. Cloudflare documents that its policies also catch unverified clients that send a matching name.

The scanner identifies itself and never sends another product's name, so it cannot see such a rule. It reports what an honestly identified client meets ([honest fetch check](/knowledge-base/no-block-on-honest-fetch)), recognises the vendor in front of the site and points to its setting ([edge rules check](/knowledge-base/edge-ai-crawler-rules)).

## How to check what the real crawlers get

Only the site owner can see this, with tools that run as the real crawlers or read their traffic:

1. **Google Search Console, URL Inspection, Test live URL.** It fetches the page as Google, from Google's addresses, and shows whether crawling was allowed and what Google received.
2. **Bing Webmaster Tools, URL Inspection.** The same for Bing, whose index feeds Copilot.
3. **Your bot manager's analytics.** Cloudflare's AI Crawl Control lists each AI crawler with its requests and whether it is allowed. Filter your security events for GPTBot, OAI-SearchBot, ChatGPT-User, ClaudeBot, Claude-User and PerplexityBot.
4. **Your server logs against the published IP lists.** OpenAI, Anthropic, Perplexity, Google, Microsoft, Apple, Amazon and others publish the addresses their crawlers use. The registry links each list. A request that claims a name from another address is not that crawler.

Besides Google and Bing, no operator documents a tool that fetches a page as its crawler for a site owner.

## FAQ

### Should I block AI crawlers?

Decide per kind. Blocking training crawlers is a licensing choice that costs nothing in search. Blocking search crawlers or assistants' fetchers removes the store from AI answers and from the shopping help people ask assistants for.

### Does Grok have a crawler I can allow or block?

xAI documents none. robots.txt cannot address Grok by name, and Grok Bot browses as the person it works for. Bot protection that challenges cloud browsers will stop it, and Grok then asks the person to solve the challenge.

### Is ChatGPT's agent the same as ChatGPT-User?

No. ChatGPT-User fetches a page a person asked about and has a robots.txt token. The cloud browser operates a site for a person, has no token and identifies itself by Web Bot Auth signatures.

### Why does the scanner not test as GPTBot?

Sending GPTBot's name from the scanner's address is impersonation. It would also appear in your AI crawler analytics as a real GPTBot visit, and bot managers that verify crawlers by address would treat it as fake. The scanner reads robots.txt for every documented name and points you to the tools that show the real traffic.

## Sources

- [OpenAI: overview of OpenAI crawlers](https://developers.openai.com/api/docs/bots)
- [OpenAI: allowing ChatGPT's cloud browser through bot protection](https://help.openai.com/en/articles/11845367)
- [Anthropic: does Anthropic crawl data from the web](https://support.claude.com/en/articles/8896518-does-anthropic-crawl-data-from-the-web-and-how-can-site-owners-block-the-crawler)
- [Anthropic: how Anthropic-hosted browsers identify themselves](https://support.claude.com/en/articles/18234133-how-do-anthropic-hosted-browsers-identify-themselves-when-they-browse-the-web-on-a-user-s-behalf)
- [Google: common crawlers](https://developers.google.com/crawling/docs/crawlers-fetchers/google-common-crawlers)
- [Google: user-triggered fetchers](https://developers.google.com/crawling/docs/crawlers-fetchers/google-user-triggered-fetchers)
- [Perplexity: crawlers](https://docs.perplexity.ai/docs/resources/perplexity-crawlers)
- [xAI: how Grok Bot works](https://docs.x.ai/grok-bot/how-grok-bot-works)
- [IETF Web Bot Auth working group documents](https://datatracker.ietf.org/wg/webbotauth/documents/)
- [Cloudflare: AI crawler and agent access policies](https://developers.cloudflare.com/bots/additional-configurations/block-ai-bots/)
- [Google Search Console: URL Inspection tool](https://support.google.com/webmasters/answer/9012289)
- [RFC 9309: Robots Exclusion Protocol](https://www.rfc-editor.org/rfc/rfc9309)
