# Discovery and social sharing

The hosted scanner renders the metadata of its pages on the server: the home page, the knowledge-base index, section pages, articles, guides and stored scan reports. Crawlers do not need to run JavaScript to read it.

- `apps/web/src/metadata.ts` owns canonical URLs, Open Graph tags (the preview data social networks read), X cards, safe JSON-LD serialisation, and the shared website, application, maintainer and image entities. JSON-LD is structured data in the page that machines read.
- Knowledge-specific entities stay beside their content in `apps/web/src/knowledge/pages.ts`.
- Hosted reports add metadata through the HTML reporter's optional title, description and head slots. Reports written by the CLI keep their self-contained defaults.

## Structured data

The JSON-LD uses [schema.org](https://schema.org/) types:

- The home page connects a `WebPage` to the `WebSite` and the `WebApplication`.
- Knowledge indexes and sections use `CollectionPage` with ordered `ItemList` entries.
- Articles carry `TechArticle`, their visible FAQ as `FAQPage` questions and answers, and `BreadcrumbList`, with page, author, section, specification and image references.
- Reports use `WebPage`, `Report` and a `Dataset` with the stored scan's level and dimension scores. The JSON export is its `DataDownload`. A commerce score that was not computed is described as "not scored" and has no numeric value. It is never filled in as zero.

Stable `@id` references connect entities across pages. The maintainer is the person credited in the footer. No company affiliation, review rating or verified checkout is implied. This markup describes the content. It does not guarantee a search feature or rich result. Reports describe public signals only.

## Report indexing and retention

Stored root reports (`/r/<id>`) and profiles (`/sites/<host>`) are **shareable, agent-readable and search-indexable**. A scan of a path or with a query string is one-time: its result stays in the browser, carries no canonical, social or schema metadata, and is sent with `no-store` and `noindex` (see [the scope decision](decisions/0014-root-profiles-and-disposable-scans.md)). A snapshot's canonical URL is `/r/<id>` and a profile's is `/sites/<host>`, both on the scanner's own domain, never on the scanned store.

- The HTML metadata and the `X-Robots-Tag` header allow indexing and large image previews.
- The JSON and Markdown exports stay accessible. They link to the canonical HTML report and send `noindex, follow`, to avoid duplicate search entries. Responses that depend on the `Accept` header send `Vary: Accept`.
- A missing or removed report returns 404 without report metadata.
- Legal-signal pages under a report (`/legal`) are sent with `noindex, nofollow, noarchive` and disallowed in robots.txt.

The app's robots.txt lets the wildcard, the listed search crawlers and the listed user-triggered fetchers read reports and the `/social/` images. The listed training crawlers may not read `/r/` and `/sites/`. The wildcard's usage preference (`Content-Signal: ai-train=yes`) still permits training, so this is not a general training ban. History (`/h/`), the API, internal paths, monitoring and the scan job pages stay disallowed for everyone. Robots rules are guidance for crawlers, not access control.

Full reports expire after the configured retention (`RETENTION_DAYS`, 30 days by default). Expiry is enforced on every read and by the cleanup cron. A profile keeps the recorded history and labels expired evidence. Profiles and snapshots are indexable when linked or shared, but the sitemap does not list them. The sitemap lists the home page, the data-processing page and the knowledge-base pages. Search engines and social services decide when they refresh or remove cached previews after expiry.

Report metadata uses the scanned origin's hostname, the scan time and the stored scores. Titles, descriptions and JSON-LD never copy URL paths, query strings, fragments, sampled product URLs, evidence or monitoring details. The public report and its JSON export keep their scan evidence as before.

## Preview images

`packages/ui/src/social-images.ts` is the manifest for three branded cards: home page, knowledge base and report. Their absolute URLs, PNG type, 1200 × 630 size and descriptive alt text appear in the Open Graph, X and JSON-LD metadata. Knowledge articles share the knowledge image but use their own title and description. Reports share a neutral report image and put the real hostname, level and scores in the text. No live report data is drawn into an image.

`apps/web/scripts/build-social-images.mjs` renders the cards during `pnpm build`, with the shared theme's purple and lime tokens, the network geometry and the self-hosted Inter font. Satori creates outlined SVG, and resvg turns it into PNG, without system fonts or remote requests. Both are build-only development dependencies, and neither runs inside the worker. The PNGs are published from `apps/web/dist/social/`, next to the static fonts, and `dev.ts` serves them locally after a build.

To change the cards:

1. Edit the manifest or the build renderer.
2. Rebuild and inspect all three PNGs at full size and as a thumbnail.
3. Give a changed image a new versioned path in the manifest (for example `/social/report-v2.png`), so social caches fetch a fresh URL.
4. Run `pnpm check`. Its regression tests cover HTML metadata, entity relationships, escaping, report scores, expiry, crawler policies, content negotiation, and PNG signatures, sizes and dimensions.
5. After deployment, check that the public images answer with `image/png` and that the metadata uses the production origin.

Do not hand-edit generated files in `dist`.

References: [Open Graph protocol](https://ogp.me/),
[Google structured-data guidelines](https://developers.google.com/search/docs/appearance/structured-data/sd-policies),
[schema.org Report](https://schema.org/Report),
[schema.org Dataset](https://schema.org/Dataset),
[Satori](https://github.com/vercel/satori), [resvg-js](https://github.com/thx/resvg-js).
