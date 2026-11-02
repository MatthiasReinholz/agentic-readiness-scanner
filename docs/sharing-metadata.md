# Discovery and social sharing

The homepage, knowledge-base index, section pages, articles and hosted scan reports
render their metadata on the server. Crawlers do not need to execute JavaScript.
`apps/web/src/metadata.ts` owns canonical URLs, Open Graph, X cards, safe JSON-LD
serialization and the shared website, application, maintainer and image entities.
Knowledge-specific entities remain beside their content in `knowledge/pages.ts`.
Hosted reports add metadata through the HTML reporter's optional title, description
and head slots; standalone CLI reports retain their self-contained defaults.

## Structured data

- The homepage connects a `WebPage` to the `WebSite` and `WebApplication`.
- Knowledge indexes and sections use `CollectionPage` and ordered `ItemList` entries.
- Articles retain `TechArticle`, their visible `FAQPage` questions and answers, and
  `BreadcrumbList`, with page, author, section, specification and image references.
- Reports use `WebPage`, `Report` and a `Dataset` of the actual stored scan's level
  and dimension scores. Its JSON export is a `DataDownload`. Unscored commerce is
  described as “not scored” and has no numeric measurement; it is never zero-filled.

Stable `@id` references connect entities across pages. The maintainer is the person
credited in the footer. No company affiliation, review rating or verified checkout
is implied. This markup describes the content; it does not guarantee a search
feature or rich result. Reports continue to describe public signals only.

## Report indexing and retention

Stored root-report HTML and `/sites/<host>` profiles are **shareable, agent-readable and search-indexable**. Path/query scans are browser-only, carry no canonical/social/schema metadata and use `no-store`/`noindex`; see [the scope decision](decisions/0014-root-profiles-and-disposable-scans.md). A snapshot's canonical URL is `/r/<id>` and a profile uses `/sites/<host>` on the scanner deployment, never the scanned store.
Both HTML metadata and `X-Robots-Tag` allow indexing and large image previews.
JSON and Markdown exports remain accessible, link to the canonical HTML report and
send `noindex, follow` to avoid duplicate search entries. Negotiated responses retain
`Vary: Accept`. A missing or removed report returns 404 without report metadata.

The wildcard, listed search crawlers and listed user-triggered fetchers can read
reports and `/social/` images. Listed training crawlers retain their `/r/` and `/sites/` restrictions.
The wildcard usage preference still permits training; this is not a universal
training prohibition. Existing history, API, internal and monitoring restrictions
remain. Robots rules are crawler guidance, not access control.

Full reports expire under the configured retention policy, enforced at reads and by cleanup. Profiles retain recorded history and label expired evidence. Dynamic profiles and snapshots are indexable when linked or shared, but are not enumerated in the sitemap. The sitemap
continues to list the homepage and durable knowledge pages. Search engines and social
services control when they refresh or remove cached previews after expiry.

Report metadata uses the scanned **origin/hostname**, scan time and stored scores.
It does not copy URL paths, query strings, fragments, sampled product URLs, evidence
or monitoring details into titles, descriptions or JSON-LD. The underlying public
report and JSON export retain their existing scan evidence.

## Preview images

`packages/ui/src/social-images.ts` is the manifest for three branded cards: homepage,
knowledge base and report. Their absolute URLs, PNG MIME type, 1200 × 630 dimensions
and descriptive alt text appear in Open Graph, X and JSON-LD metadata. Knowledge
articles share a knowledge image but use their own title and description. Reports
share a neutral report image and use the real hostname, level and scores in text.
No live report data is embedded in an image.

`apps/web/scripts/build-social-images.mjs` renders the cards during `pnpm build`,
using the shared theme's purple/lime tokens, network geometry and self-hosted Inter
font. Satori creates outlined SVG internally and resvg rasterizes PNGs without system
fonts or remote requests. Both are build-only development dependencies; neither runs
inside the worker. The generated PNGs are published from `apps/web/dist/social/`,
alongside static fonts, and served locally by `dev.ts` after a build.

To change the cards, edit the manifest or build renderer, rebuild and inspect all
three PNGs at full size and as a thumbnail. Give changed images a new versioned path
in the manifest so social caches can fetch a fresh URL. Do not hand-edit generated
files in `dist`. Run `pnpm check`: regression tests cover HTML metadata, entity
relationships, escaping, report scores, expiry, crawler policies, negotiation and PNG
signatures, sizes and dimensions. After deployment, verify public image responses
are successful `image/png` responses and that metadata uses the production origin.

References: [Open Graph protocol](https://ogp.me/),
[Google structured-data guidelines](https://developers.google.com/search/docs/appearance/structured-data/sd-policies),
[schema.org Report](https://schema.org/Report),
[schema.org Dataset](https://schema.org/Dataset),
[Satori](https://github.com/vercel/satori), [resvg-js](https://github.com/thx/resvg-js).
