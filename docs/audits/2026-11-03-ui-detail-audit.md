# UI detail audit, 2026-11-03

**What was audited.** The layout details of every page of the hosted scanner (the web app): the home page and scan console, hosted and standalone reports, root profiles, historical summaries, one-time (disposable) reports, the knowledge base indexes, sections and articles, the monitoring forms, dialog and status pages, and the error pages.

**Why.** The pages had small but visible faults. Check ids such as `B4` broke across two lines, forms got squeezed on tablets, spacing differed between similar panels, and enlarged text crowded report rows. The goal was to fix these without changing the design itself. The purple and lime identity, the themes, the metadata and the transition from scan to report stayed as they were.

**How.** A browser run over every page family at many widths, in both themes and at 200% text size, before and after the changes (see Verification). Findings are ranked P1 (most severe) to P3 (least severe).

## Findings and resolutions

- **[P1] Compact ids wrapped inside cards.** The first browser run reproduced `B4` and `B5` wrapping at 320px, and `B2`, `B4` and `B5` at 1280px. Flexible headings and inherited word breaking could squeeze a badge. Badges now resist shrinking and wrapping, and catalog identifiers share one recipe that keeps them on a single line. Titles have their own flexible text spans. Long prose and code keep their own wrapping rules.
- **[P2] Form layout followed the viewport width instead of the space actually available.** Nested monitoring forms on tablets could squeeze email inputs. Hero and monitoring controls now use container queries (layout rules based on the width of the containing element), minimum control heights and flexible text. Dialog close controls have their own sticky row and receive focus first, so opening a dialog does not bring up the mobile keyboard. The close action stays reachable when enlarged content scrolls.
- **[P2] Enlarged text crowded report rows.** Verdicts, code ids and actions competed for a narrow column. Detailed checks and knowledge rows now stack their content when their container is narrow. Section scores have their own fallback row. Verdict counts wrap as complete units. Long actions can grow vertically. Hero and history level summaries also reflow without clipping their text.
- **[P2] Overview layouts were uneven.** The third score card now spans the tablet row, and wider layouts use three equal cards. The check map keeps its named transition and switches between compact and labelled rows depending on the available space. Labels and scores stay aligned while cells wrap within their track.
- **[P2] Spacing varied between equivalent surfaces.** Primary panels share 16px insets on mobile and 24px on wider screens. Compact cards use 16px. Hidden scan-console markup no longer adds an extra 44px above the first visible section of the home page. Major home page sections are 40px apart, and live progress has its own explicit spacing.
- **[P2] Hover and focus styles overlapped or disappeared.** Knowledge cells now move slightly and use an outline without growing over neighbouring cells. Gaps and corner radii match the report cells. Finished arrival animations release the `transform` property, so hover and focus feedback still works. Focus outlines on disclosures stay inside clipped card frames. Shared focus defaults cover native controls and text links.
- **[P2] Wide examples needed consistent keyboard access.** Code blocks in articles, fixes and reports share one style and can receive focus for scrolling. Reference and history tables scroll horizontally in a labelled region. Long URLs stay readable within the page.
- **[P3] Secondary type and controls drifted.** Body text, secondary paragraphs, metadata, code and panel headings now follow the shared type scale. Level labels agree across reports and history. Textareas use 16px text on phones, and filter chips have the same 44px minimum target height as other controls.

## Shared rules

The implementation lives in [the UI package](../../packages/ui/README.md), mainly in `recipes.ts` and `surfaces.css`. The check-map motion stays with the report renderer, and knowledge navigation stays with the knowledge renderer.

- Use `identifier` for compact catalog and section ids, and `badge()` for status and tier pills.
- Use `panel` for the insets of primary cards. Compact cards and dense disclosure rows have explicit, documented spacing instead of unrelated in-between padding values.
- Keep body text at 16px/24px, prose at 16px/28px, secondary paragraphs at 14px/24px, dense labels at 14px/20px and metadata at 12px/20px. Cards use 16px headings, major sections 18px and article sections 20px. Display type stays fluid.
- Buttons are at least 44px high and grow for wrapped text. Hero fields are at least 52px high. Field text, inset and chevron placement share the input recipe.
- Interactive map cells are 24px at the default text size. Legend symbols are smaller decoration. Keyboard focus stays distinct from verdict and selection colours.
- Reflow according to the width of the containing component. Keep real tables and preformatted code in their own scroll regions.

## Verification

- **644 baseline cases:** 23 routes at 320, 375, 414, 639, 640, 767, 768, 799, 800, 1023, 1024, 1280, 1440 and 1920px in both themes. No horizontal overflow of the page, no wrapped catalog ids and no control text colliding with its padding. The routes include three reports with different verdict mixes, profiles, history, knowledge pages, all five monitoring status states, errors, long URLs, disposable and standalone reports, and the home page without JavaScript (which keeps its static dark fallback).
- **200% text:** 32 cases across eight page families at 320, 375, 768 and 1280px, including expanded report sections, fixes and evidence. This found one squeezed article action. After the correction, 84 knowledge cases at normal size and 16 at enlarged size passed in both themes.
- **34 final targeted cases:** home page and footer at normal and 200% text, plus home page, report and article at 844×390, 1024×600 and 1920×1080 in both themes. No overflow, identifier wrapping or control text colliding with its padding was detected.
- **Dialog and controls:** monitoring inputs and actions align at 44px with 16px text at 320, 375, 640, 768 and 1280px. At 320px and 200% text, keyboard navigation scrolls the content while the close button stays inside the visible dialog.
- **Interaction checks:** knowledge search and priority filters update the visible count correctly. Keyboard focus on a 24px knowledge cell shows a visible outline and a 2px shift, without scaling over neighbouring targets. Code and table regions stay reachable by keyboard. The real handoff from a fixture-backed scan to its report was checked in the browser. The transition names and arrival logic of the check map and level badge are unchanged.
- **Quality gate:** `pnpm check` passes, including formatting, repository rules, build, lint, types, tests, catalog validation and the check that generated documents match their sources. A separate review of the whole change was completed and its actionable findings resolved.

These checks used the current embedded browser and representative content. They are evidence for the audited layouts, not a claim about every possible browser, translation or future text. No dependencies or scanning rules changed in this visual audit.

## Follow-up

The rules above (no page-level overflow, ids on one line, 44px controls, the shared page shell, the handoff from scan to report and reduced motion) are automated in `apps/web/e2e` and run in CI as `pnpm test:layout`, at five widths in both themes and at 200% text.
