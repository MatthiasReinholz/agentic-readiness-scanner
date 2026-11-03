# Proposal: legal signals for online stores

Date: 2026-11-03. Status: proposed, awaiting a decision. Legal status checked on 2026-11-03.

## Summary

Yes, a useful set of legal checks can be built. Many legal duties for online stores leave public, machine-observable traces: a seller identity block, a privacy notice, a withdrawal button with prescribed wording, a manufacturer on the product page, an accessibility statement, a machine-readable opt-out file, a national tax ID with a check digit. The scanner already finds most of the pages these traces live on (B4 discovers returns, shipping, privacy, terms, imprint and contact pages). What a scanner cannot do is judge whether the content is correct, whether a law applies to a given business (size, B2C, where it sells), or anything that happens after JavaScript, sign-in or checkout.

The proposal is a new category, **Legal signals**, with these properties:

- 24 checks in six groups.
- Each check is tagged with every law it relates to, across the EU (with national examples), the US federal level and states, Canada and its provinces, the UK, Switzerland, Australia, and Brazil, Argentina, Chile, Colombia and Peru.
- The checks are reported, never scored, and never part of the readiness level. Verdicts read "found", "not found in the pages read" or "review", never "compliant" or "violation".
- Each check runs only for markets the store appears to sell to. Markets are detected from public signals, with an override.
- A disclaimer on every surface says these results are a technical evaluation, not legal advice, and can be wrong.

The checks fit the scanner's purpose, not just its plumbing. Agents read the same signals a regulator looks for: who the seller is, the return window, whether a page is usable through its accessibility tree, whether content is reserved from AI training, whether a bot discloses itself. Several of these duties have machine-readable forms (schema.org `MerchantReturnPolicy` and `Organization.vatID`, `/.well-known/gpc.json`, `/.well-known/tdmrep.json`, robots.txt), so a store that gets them right is legible to both humans and agents.

## What is and is not decidable

| Decidable from public HTTP without JavaScript                                                                                                                                       | Not decidable                                                                                            |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| A link or button with prescribed wording on the pages read (withdrawal function, botón de arrepentimiento, "Do Not Sell or Share", Libro de Reclamaciones, accessibility statement) | Whether the law applies: company size, turnover, B2B only, establishment, which customers it targets     |
| Structured identity data on a page: email, geographic address, VAT ID, company number, CNPJ, RUT, NIT, Swiss UID (with check-digit validation where one exists)                     | Whether the disclosed details are true or complete                                                       |
| A privacy notice that names a controller, DPO or privacy-officer contact                                                                                                            | Whether consent is actually obtained, or GPC actually honoured (both happen in browser JavaScript)       |
| Product-page fields: manufacturer, EU responsible person, identifiers                                                                                                               | Anything during checkout: pre-contract information, drip pricing at the payment step, order confirmation |
| Machine-readable files and headers: robots.txt AI groups, `tdmrep.json`, `tdm-reservation`, `gpc.json`, cookies set on the first response                                           | WCAG conformance beyond a small static subset (contrast, keyboard flow and focus need a rendered page)   |
| Known vendor scripts in the static HTML: chat widgets, accessibility overlays, trackers without a consent-blocking attribute                                                        | What a chatbot tells the user, or whether an image was AI-generated when its metadata is stripped        |
| Outdated legal text, for example a link to the EU ODR platform, which closed on 20 July 2025                                                                                        | Personalised pricing, geo-blocking from a single vantage point, the truth of a "30-day lowest price"     |

The left column becomes checks. The right column is stated in the disclaimer and in each check's knowledge-base article.

## Design

### Reported, never scored

The current weight model already has `info`, meaning "reported, never scored". Every legal check uses it. The six groups form a third dimension, `legal`, with no score and no level. Two reasons:

1. A percentage implies a degree of compliance, which the scanner cannot measure.
2. Applicability is uncertain, so a missing disclosure might be legally fine for that business. A score would turn that uncertainty into a number.

The report shows the section as counts ("9 found, 3 not found, 2 to review, 12 not applicable") and a list per group. In this section the verdict words are relabelled: pass becomes **Found**, fail becomes **Not found in the pages read**, warn becomes **Review**. Skip stays **Not applicable** (market not detected) or **Could not check**.

### Laws as data

A new `packages/catalog/data/laws.json` holds one entry per legal provision:

```json
{
  "id": "eu-crd-11a",
  "jurisdiction": "EU",
  "name": "Consumer Rights Directive, Art. 11a (withdrawal function)",
  "instrument": "Directive 2011/83/EU as amended by Directive (EU) 2023/2673",
  "url": "http://data.europa.eu/eli/dir/2023/2673/oj",
  "applies_from": "2026-06-19",
  "national": [
    {
      "jurisdiction": "DE",
      "name": "BGB §356a",
      "url": "https://www.gesetze-im-internet.de/bgb/__356a.html"
    }
  ],
  "verified": "2026-11-03"
}
```

Each check lists `laws: [...]`. This satisfies the repository rule that every check cites a public URL, here the official text (EUR-Lex ELI, legislation.gov.uk, fedlex, planalto.gov.br, leginfo and similar).

`applies_from` lets a check run before its law takes effect. Until then it reports "Applies from 1 January 2027" as information, so stores can prepare, and it never shows as not found.

`verified` records the last re-check. The catalog build warns when a law entry is more than 120 days old, so the legal text gets re-checked about once a quarter.

### Markets: who the store sells to

Region-specific checks run only for markets the store appears to target. Otherwise a German shop would see a Brazilian CNPJ check as "not found".

- **Detection, from evidence the scan already has:**
  - The ccTLD.
  - `html lang` and `hreflang`.
  - `priceCurrency` in Offer markup.
  - `addressCountry` in Organization markup.
  - `shippingDetails.shippingDestination` and `MerchantReturnPolicy.applicableCountry`.
  - Telephone prefixes.
  - National ID patterns found on the identity page.
- **Output:** a list of markets with their evidence, for example `EU (DE): .de domain, EUR prices, lang de, DE VAT ID`.
- **Override:** a `markets` option on the CLI (`--markets eu,uk,us-ca`), the API, MCP and the form ("Where do you sell? Detect / choose"). The override always wins.
- **Fallback:** when nothing is detected, only market-neutral checks run, such as a privacy notice and seller contact. Regional checks skip as not applicable with "No sign this store sells to Brazil; set markets to include it."

The result object gains optional, additive fields:

- `target.markets`: the detected or chosen markets, with evidence.
- `laws` on each check result.
- A top-level `legal_notice`: the disclaimer text.

Existing consumers ignore unknown fields, so the `schema` id stays `agentic-readiness-scanner/1`. No new verdict and no new skip reason is needed.

### Implementation constraints

- **Parsers:** Checks follow the existing rules. Pattern tables (multilingual labels, ID formats with check-digit validators) go in a new parser module `packages/core/src/parsers/legal.ts`. The withdrawal-function labels come from the 24 official-language versions of Art. 11a on EUR-Lex, not from translations.
- **Request budget:** Almost every check reads pages the scan already fetches (home, policy pages, product pages). The additions are at most `/.well-known/gpc.json` and `/.well-known/tdmrep.json`. Imprint and contact pages are already discovered. The default budget of 40 holds.
- **Catalog validation:** `CHECK_ID_PATTERN` (`^[AB][1-5]\.\d{1,2}$`) widens to accept `C`, and the dimension enum gains `legal`.
- **Fixtures:** Each regional check needs a passing and a failing case. New recorded fixtures: a German shop, a UK shop, a Brazilian shop, an Argentine shop and a Californian shop.
- **Knowledge base:** Each check gets an article in the existing format, with one extra section, "Which laws", listing each law with its jurisdiction, official link and date. The FAQ answers "Does this apply to my store?".

## The checks

Strength:

- **S** means the check decides from a concrete, reliable signal.
- **I** means informational: it detects a risk or a hint and asks for review.

"Laws" lists the tags. National items are examples, not complete lists.

### C1 Seller identity and complaints

| ID   | Check                                                   | Signal                                                                                                                                                                                                                 | Laws                                                                                                                                                                                                                                                                     | Strength                             |
| ---- | ------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------ |
| C1.1 | Seller identity block                                   | Identity or imprint page (already discovered) with a legal name, a geographic address and an email address. A contact form alone does not count. Organization markup counts as supporting evidence.                    | EU E-Commerce Directive Art. 5; DE DDG §5; AT ECG §5; UK Electronic Commerce Regulations 2002 reg. 6; CH UWG Art. 3(1)(s); US-CA Civ. Code §1789.3; CA-ON O. Reg. 17/05 s.32; CA-QC CPA s.54.4; BR Decreto 7.962/2013 Art. 2; CL Ley 19.496 Art. 32; CO Ley 1480 Art. 50 | S                                    |
| C1.2 | Registration and tax IDs where the market requires them | Pattern plus check digit: EU VAT IDs; UK company number with "Registered in England and Wales" and registered office; Swiss UID `CHE-123.456.789`; CNPJ; RUT; NIT; CUIT; Peruvian RUC. Runs only for detected markets. | EU ECD Art. 5(1)(c),(e); UK SI 2015/17 regs. 24 and 25; BR Decreto 7.962 Art. 2(I); CL e-commerce regulation (2022); CO Ley 1480 Art. 50(a)                                                                                                                              | S                                    |
| C1.3 | Peru: Libro de Reclamaciones                            | A link whose text or image alt contains "Libro de Reclamaciones".                                                                                                                                                      | PE Ley 29571 Art. 150 and its regulation                                                                                                                                                                                                                                 | S (verify the amending decree first) |
| C1.4 | No outdated dispute-resolution link                     | A link to `ec.europa.eu/consumers/odr`. The ODR Regulation was repealed with effect from 20 July 2025. Shown as legal-text hygiene, not a breach.                                                                      | EU Regulation (EU) 2024/3228                                                                                                                                                                                                                                             | I                                    |

### C2 Privacy notices and choices

| ID   | Check                                             | Signal                                                                                                                                                                                                                                                                                                                        | Laws                                                                                                                                                                                                                                                        | Strength     |
| ---- | ------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------ |
| C2.1 | Privacy notice linked from the home page          | A home-page link whose text contains the market's word for privacy, resolving to a page that names a controller and gives a contact. Builds on B4.3, which only asks whether a page exists.                                                                                                                                   | GDPR Art. 13; UK GDPR Art. 13; CH revFADP Art. 19; US-CA CalOPPA (Bus. & Prof. Code §22575, which requires a home-page link containing "privacy"); CA PIPEDA Principle 4.8; CA-QC Law 25 s.8.2; AU APP 1; BR LGPD Art. 9; CO Ley 1581 and Decreto 1377/2013 | S            |
| C2.2 | Privacy contact published                         | The privacy notice names a DPO, encarregado, privacy officer or "responsable de la protection des renseignements personnels", with an email address.                                                                                                                                                                          | GDPR Art. 37(7); BR LGPD Art. 41 §1 and Res. CD/ANPD 18/2024; CA-QC Law 25 s.3.1                                                                                                                                                                            | S            |
| C2.3 | California opt-out links                          | Link text "Do Not Sell or Share My Personal Information", "Your Privacy Choices" or "Limit the Use of My Sensitive Personal Information", or the opt-out icon. Not found is reported as review, because businesses below the thresholds, or that sell no data, need no link.                                                  | US-CA Civ. Code §1798.135; CCPA Regulations §§7013–7015                                                                                                                                                                                                     | S (presence) |
| C2.4 | Global Privacy Control declared                   | `/.well-known/gpc.json` is valid with `"gpc": true`, or the privacy notice mentions Global Privacy Control or opt-out preference signals. Honouring GPC happens in JavaScript and cannot be verified; the check says so.                                                                                                      | US-CA CCPA Regulations §7025; Colorado, Connecticut, Texas, Oregon, Montana, Delaware, Nebraska, New Hampshire, New Jersey, Minnesota and Maryland universal opt-out rules; GDPR Art. 21(5)                                                                 | I            |
| C2.5 | No advertising cookies or trackers before consent | `Set-Cookie` on the first response with known advertising or analytics names; tracker tags in the static HTML without a consent-blocking attribute (`type="text/plain"`, `data-cookieconsent`, a denied Consent Mode default). Most trackers load through JavaScript, so a clean result means "none seen", never "compliant". | ePrivacy Directive Art. 5(3) and CJEU Planet49; UK PECR reg. 6 (analytics exception from 5 February 2026 under the Data (Use and Access) Act 2025); CA-QC Law 25 s.8.1; CH revFADP                                                                          | I            |

### C3 Withdrawal, returns and cancellation

| ID   | Check                                          | Signal                                                                                                                                                                                                                                                                                                                        | Laws                                                                                                                                                                                                                   | Strength |
| ---- | ---------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------- |
| C3.1 | EU withdrawal function                         | A link or button labelled "withdraw from contract here" or the official equivalent in the page language (DE "Vertrag widerrufen"), on the home page or in the shared footer. The second step ("confirm withdrawal") and the acknowledgement cannot be verified.                                                               | EU CRD Art. 11a (from 19 June 2026); DE BGB §356a                                                                                                                                                                      | S        |
| C3.2 | Argentina: withdrawal and cancellation buttons | "Botón de arrepentimiento" on the first screen of the home page; "botón de baja" where services or subscriptions are sold.                                                                                                                                                                                                    | AR Disposición SSDCyLC 954/2025 (replaces Res. 424/2020 and 316/2018); Ley 24.240 Art. 34                                                                                                                              | S        |
| C3.3 | Statutory return period stated                 | The returns policy (already discovered by B4.1) or `MerchantReturnPolicy.merchantReturnDays` states at least the market's statutory period: EU and UK 14 days, BR 7 days, CL 10 days, AR 10 days, CO 5 business days. Also matches the withdrawal-period wording ("Widerrufsrecht", "derecho de retracto", "arrependimento"). | EU CRD Art. 9; UK Consumer Contracts Regulations 2013 regs. 29–31; BR CDC Art. 49; CL Ley 19.496 Art. 3 bis; CO Ley 1480 Art. 47; AR Ley 24.240 Art. 34                                                                | S        |
| C3.4 | Subscription cancellation route published      | Runs only when subscription offers are detected ("auto-renew", "billed monthly", `billingDuration`). Looks for a published online cancellation route. Rules that are not yet in force report "applies from".                                                                                                                  | US-CA Bus. & Prof. Code §17602 (as amended by AB 2863); DE BGB §312k; UK DMCC Act 2024 Part 4 Ch. 2 (draft regulations for 1 January 2027); AU Unfair Trading Practices Act 2026 (from 1 July 2027); AR Disp. 954/2025 | I        |

### C4 Accessibility

| ID   | Check                          | Signal                                                                                                                                                                                                                                                                                                     | Laws                                                                                                                                                                                                                                                                                          | Strength     |
| ---- | ------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------ |
| C4.1 | Accessibility statement linked | A link to an accessibility statement in the page language ("Accessibility", "Barrierefreiheit", "Accessibilité", "Toegankelijkheid", "Acessibilidade"). For Brazil, the accessibility symbol shown prominently.                                                                                            | EU EAA Directive 2019/882 Art. 13 and Annex V (from 28 June 2025; microenterprises exempt); DE BFSG; BR LBI Art. 63 §1; CA-ON AODA (reporting)                                                                                                                                                | S (presence) |
| C4.2 | Static accessibility basics    | On the home page and sampled product pages: `html lang`; a `title`; `alt` on content images; labels on form controls; accessible names on links and buttons; zoom not disabled by `user-scalable=no` or `maximum-scale=1`. The report states that automated checks catch only a minority of WCAG failures. | EU EAA with EN 301 549 (WCAG 2.1 AA); US ADA Title III (case law) and CA Unruh Act; CA-ON AODA IASR s.14 (WCAG 2.0 AA, 50+ employees); CA-MB Accessible Information and Communication Standard; UK Equality Act 2010 s.20 and s.29; AU DDA 1992 s.24; BR LBI Art. 63 with ABNT NBR 17225:2025 | I            |
| C4.3 | Accessibility overlay detected | Scripts from overlay vendors. Information only: an overlay does not make a site conformant, and regulators and courts have said so.                                                                                                                                                                        | Same tags as C4.2                                                                                                                                                                                                                                                                             | I            |

A3.5 (accessible main content) and A3.10 (mobile viewport) stay where they are; C4.2 reuses their parsing.

### C5 Product and price information

| ID   | Check                                                   | Signal                                                                                                                                                                                                                                                                                                                       | Laws                                                                                                                                | Strength       |
| ---- | ------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- | -------------- |
| C5.1 | Manufacturer and EU responsible person on product pages | On sampled product pages: a manufacturer name with a postal and electronic address ("Hersteller", "Manufacturer"); a "responsible person" when the manufacturer is outside the EU; product identifiers; Product `manufacturer` or `brand` markup. Whether warnings are needed depends on the product and cannot be verified. | EU GPSR Regulation (EU) 2023/988 Art. 19 (since 13 December 2024)                                                                   | S (presence)   |
| C5.2 | Discounts show the prior lowest price                   | Runs only when a struck-through price appears (`del`, `s`, a price pair). Looks for "lowest price in the last 30 days" wording in the page language. The truth of the price history cannot be checked.                                                                                                                       | EU Price Indication Directive 98/6/EC Art. 6a and CJEU C-330/23; CH PBV; UK Price Marking Order 2004 (as amended from 6 April 2026) | I              |
| C5.3 | Review verification is explained                        | Runs only when reviews are present (`AggregateRating` or a review widget). Looks for a statement on how reviews are checked, and for review markup that is internally consistent.                                                                                                                                            | EU UCPD Art. 7(6) and Annex I points 23b and 23c; UK DMCC Act 2024 Sch. 20 para. 13; US FTC 16 CFR Part 465                         | I              |
| C5.4 | Generic environmental claims                            | Flags generic claims ("climate neutral", "eco-friendly", "klimaneutral") on the pages read, for human review.                                                                                                                                                                                                                | EU Directive (EU) 2024/825 (from 27 September 2026); UK CMA Green Claims Code and DMCC Act; US FTC Green Guides (16 CFR 260)        | I              |
| C5.5 | Swiss price display                                     | Runs only for Swiss-facing stores: CHF prices, with VAT included and stated.                                                                                                                                                                                                                                                 | CH Price Indication Ordinance (PBV)                                                                                                 | S (when Swiss) |

### C6 AI transparency and content rights

| ID   | Check                                                | Signal                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        | Laws                                                                                                                                                                           | Strength |
| ---- | ---------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------- |
| C6.1 | AI chat assistant detected                           | Known chat and AI-assistant vendor scripts in the static HTML. The disclosure itself appears inside the widget and cannot be verified; the check names the duty and the vendor.                                                                                                                                                                                                                                                                                                               | EU AI Act Art. 50(1) (since 2 August 2026; a provider duty, often the vendor's); US-CA BOT Act (Bus. & Prof. Code §§17940–17943); Utah AI Policy Act; Maine 10 M.R.S. §1500-DD | I        |
| C6.2 | Machine-readable reservation of text and data mining | Classifies what the store publishes: AI-training groups in robots.txt, `Content-Usage`, `/.well-known/tdmrep.json`, a `tdm-reservation` header or meta tag, or only terms-of-service text. Terms-only fails the machine-readability test after the Hamburg Higher Regional Court (5 U 104/24, 10 December 2025). Reports "explicit / partial / terms only / none" and, most useful for this scanner, warns when the reservation also blocks the search or user-triggered agents scored in A2. | EU DSM Directive 2019/790 Art. 4(3); EU AI Act Art. 53(1)(c); DE UrhG §44b(3)                                                                                                  | I        |
| C6.3 | AI-generated images marked (later phase)             | On sampled product images: C2PA manifests or IPTC `DigitalSourceType = trainedAlgorithmicMedia`. Needs image fetches, and stripped metadata proves nothing, so this comes last, if at all.                                                                                                                                                                                                                                                                                                    | EU AI Act Art. 50(2) and 50(4)                                                                                                                                                 | I        |

C6.2 is the clearest example of a legal check that is also an agentic one. The reservation only has legal effect when machines can read it. A store that blocks training carelessly often blocks the agents that would sell its products. A2.1 stays the scored check for "is the policy stated". C6.2 adds the legal reading on top.

## What will not be built, and why

| Topic                                                                                                        | Reason                                                                                                                                                       |
| ------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| "Cookie compliant", "WCAG conformant" or "AI Act compliant" verdicts                                         | Not decidable without rendering, and misleading in any form                                                                                                  |
| GPC actually honoured                                                                                        | Happens in browser JavaScript. A double fetch with `Sec-GPC: 1` might reveal server-side handling on rare sites; considered only if C2.4 shows demand        |
| Checkout-stage duties: pre-contract information, button wording, drip pricing at payment, order confirmation | The scanner never enters checkout and never will (honest fetch, decision 0010)                                                                               |
| DSA Arts. 11, 12, 25, 26 and 30                                                                              | They apply to intermediaries and online platforms, not single-seller stores; at most a marketplace profile later                                             |
| Geo-blocking, personalised pricing                                                                           | Not decidable from one vantage point and one fetch                                                                                                           |
| CASL, Spam Act, CAN-SPAM                                                                                     | They govern messages sent, which are not observable                                                                                                          |
| Quebec French-language duties                                                                                | Applicability cannot be observed and the "equally favourable" test cannot be measured; possibly a later informational note when a Quebec address is detected |
| Laws that are not in force, such as Brazil PL 2338/2023, Chile's AI bill and Canada's Bill C-36              | Tracked in the law registry and added when enacted                                                                                                           |

## Disclaimer

Shown at the top of the Legal signals section in HTML and Markdown reports, in `legal_notice` in JSON, in the MCP tool output and on every legal knowledge-base article:

> **Legal signals are a technical evaluation, not legal advice.** They show what this scan could read on the store's public pages: whether certain disclosures, links and machine-readable signals are present. They cannot tell whether the content is correct or complete, whether a law applies to this business (its size, where it sells, whether it sells to consumers), or anything shown only after JavaScript runs, after signing in or during checkout. Results can be wrong when pages fail to load, render in the browser, block automated access, differ by region or language, or use a setup the scanner does not recognise. "Found" does not mean compliant and "not found" does not mean a breach. Ask a qualified lawyer before relying on them.

The home page and the knowledge-base index get a one-line version linking to the full text.

## Plan

### Phase 0: foundations (one PR)

1. Decision record 0015 for the category, the no-score rule, the market model and the disclaimer.
2. Law registry `laws.json`, its schema and validation:
   - Official URL required.
   - `applies_from` and `verified` dates.
   - A staleness warning.
   - Laws are listed in `docs/checks.md` (generated) and get a page at `/knowledge-base/laws`.
3. Catalog changes:
   - The `legal` dimension.
   - `C` check IDs.
   - `laws` on checks.
   - `markets` on checks: the markets a check needs, or `any`.
4. Engine changes:
   - Market detection in the target resolver, plus the override on the CLI, API, MCP and the form.
   - Additive result fields.
   - The legal parser module (labels, ID validators with check digits).
5. Reporters: the Legal signals section with relabelled verdicts and the disclaimer, in HTML, Markdown and JSON. The layout suite gains the new section.

### Phase 1: strong checks that reuse pages already fetched

C1.1, C1.2, C1.4, C2.1, C2.2, C2.3, C3.1, C3.2, C3.3, C4.1, C4.2.

Fixtures: German, UK, Brazilian, Argentine and Californian shops, each with passing and failing cases. A knowledge-base article per check.

### Phase 2: product pages, machine-readable files and risk signals

C5.1, C2.4, C2.5, C6.1, C6.2, C1.3, C4.3, C5.5. Adds the two well-known file fetches.

### Phase 3: informational and dated checks

C3.4 (with `applies_from` gates for the UK from 1 January 2027 and Australia from 1 July 2027), C5.2, C5.3, C5.4.

Dated registry entries:

- Australia APP 1.7 automated-decision disclosure in privacy policies, from 10 December 2026.
- Chile Ley 21.719, from 1 December 2026, possibly postponed to 2027.
- C6.3 only if Phase 2 data shows it is worth the image requests.

### Before any check ships

Each provision below rests partly on secondary sources and must be re-read in the official text:

- The 24 language versions of CRD Art. 11a.
- The Boletín Oficial text of Disposición 954/2025.
- Peru's amending decree for the Libro de Reclamaciones.
- The number of Chile's e-commerce regulation.
- The BFSG section for the accessibility statement.
- CCPA Regulations §7025 as amended from 1 January 2026.
- The Oregon and Delaware universal opt-out start dates.
- The UK subscription regulations' parliamentary approval.

An audit document like the 2026-10-31 check audit records the source for every law entry.

## Decisions needed

1. **Reported, not scored** (recommended), or a third scored dimension.
2. **On by default** for store profiles below the readiness report (recommended), or an opt-in toggle. Content sites would run only C1, C2, C4 and C6.
3. **Name of the section:** "Legal signals" (recommended, because it says what is measured) or "Compliance".
4. **Scope of Phase 1** as listed, or a narrower start, for example EU and US only.

## Research basis

This proposal draws on three research passes made on 2026-11-03, one each for the EU, the US and Canada, and the UK, Switzerland, Australia and South America. Each provision was checked against official texts where they were reachable and against current law-firm briefings where not. The main sources:

- [EU AI Act, Regulation (EU) 2024/1689](http://data.europa.eu/eli/reg/2024/1689/oj), as amended by the Digital Omnibus on AI (Regulation (EU) 2026/1744): Art. 50 has applied since 2 August 2026, and Art. 50(2) applies from 2 December 2026 for systems already on the market.
- [Directive (EU) 2023/2673](http://data.europa.eu/eli/dir/2023/2673/oj), which inserts the withdrawal function as CRD Art. 11a from 19 June 2026.
- [European Accessibility Act, Directive (EU) 2019/882](http://data.europa.eu/eli/dir/2019/882/oj).
- [General Product Safety Regulation, Regulation (EU) 2023/988](http://data.europa.eu/eli/reg/2023/988/oj).
- [DSM Copyright Directive, Directive (EU) 2019/790](http://data.europa.eu/eli/dir/2019/790/oj), and the Hamburg Higher Regional Court's 2025 ruling in Kneschke v LAION.
- [Regulation (EU) 2024/3228](http://data.europa.eu/eli/reg/2024/3228/oj), which repeals the ODR Regulation.
- [Directive (EU) 2024/825](http://data.europa.eu/eli/dir/2024/825/oj), empowering consumers for the green transition.
- [Global Privacy Control specification](https://w3c.github.io/gpc/) and the [CPPA regulations](https://cppa.ca.gov/regulations/).
- [UK Electronic Commerce Regulations 2002, reg. 6](https://www.legislation.gov.uk/uksi/2002/2013/regulation/6) and [UK Data (Use and Access) Act 2025, s.112](https://www.legislation.gov.uk/ukpga/2025/18/section/112).
- [Swiss Unfair Competition Act (UWG)](https://www.fedlex.admin.ch/eli/cc/1988/223_223_223/de) and [revFADP](https://www.fedlex.admin.ch/eli/cc/2022/491/de).
- [OAIC guidance on APP 1](https://www.oaic.gov.au/privacy/australian-privacy-principles-guidelines/chapter-1-app-1-open-and-transparent-management-of-personal-information/).
- [Brazil LGPD](https://www.planalto.gov.br/ccivil_03/_ato2015-2018/2018/lei/l13709.htm) and [Decreto 7.962/2013](https://www.planalto.gov.br/CCivil_03/_Ato2011-2014/2013/Decreto/D7962.htm).
