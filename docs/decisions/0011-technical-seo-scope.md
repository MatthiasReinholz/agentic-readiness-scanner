# 0011 Conventional technical SEO is scored only where a documented AI surface depends on it

Date: 2026-11-01. Status: accepted.

## Context

Every AI answer product sits on a conventional web index. Google documents that AI Overviews and AI Mode need a page to be "indexed and eligible to be shown in Google Search with a snippet" and nothing more; Microsoft documents that Bing and Copilot "rely on the same core crawling, indexing, and ranking foundation" and writes grounding eligibility into its webmaster guidelines; ChatGPT search names Bing as a provider, Claude search runs on Brave, which follows Googlebot's robots rules and honours `noindex`; DuckDuckGo's assistant draws on Bing. So classic indexability is a precondition for being cited, and a scanner that ignored it would call a store ready that no assistant can find.

At the same time, most of what technical SEO tools report has no documented effect on inclusion or citation: title lengths in pixels, heading order, word counts, Core Web Vitals, security headers, favicons, Open Graph tags, HTTP/2, the `lang` attribute. Adding them would lengthen reports with items a shop owner cannot tie to any outcome.

## Decision

- A technical SEO property joins the catalog when a vendor document ties it to indexing, to eligibility for an AI surface, or to how a citation is built. The 2026-11-01 audit ([docs/audits/2026-11-01-technical-seo-audit.md](../audits/2026-11-01-technical-seo-audit.md)) records the evidence per check.
- Snippet eligibility is a gate. Google's AI features require it, Apple generates no web answer without it, and Bing limits citations without it, so A2.6 fails on `nosnippet`, `max-snippet:0` and `data-nosnippet` around the main content, and Level 2 requires it.
- The following are judged: render resources not blocked (A2.7), the 2 MB document cutoff (A3.3), canonical correctness (A3.4), direct URLs over HTTPS with host consolidation (A3.7), title and description (A3.8), conditional requests (A3.9), mobile viewport (A3.10), a well-formed head (A3.11), and crawlable listing links and pagination (A1.8).
- Refused, with the reason recorded in the audit: title, description, heading and URL length rules; H1 counts; word-count and text-to-HTML ratios; Core Web Vitals and page-speed scores beyond the response-time hint; favicon; Open Graph and Twitter cards; HTTP/2 and compression (not decidable from a web-standard fetch); security headers; `lang` validity (Google ignores it); hreflang reciprocity (would need fetching every alternate); internal link depth and counts; duplicate-content similarity across the sample; IndexNow (the key is unpublished); llms.txt as an eligibility signal.
- The scanner still never renders pages and never fetches with another product's user agent (decision 0010). Mobile parity is therefore not judged, only declared; the catalog text says so.

## Consequences

- A store that is invisible to Google or Bing for a conventional reason (a canonical pointing elsewhere, a title after an injected iframe, a redirecting sitemap URL) is now told so, with the vendor's own rule as the citation.
- The scan spends up to four more requests: the http:// form of the origin, the other host variant, one conditional re-request, and the listing page.
- When a vendor documents a new dependency (Bing's `ai-grounding` preferences take effect in 2027), the catalog changes; folklore does not move it.
