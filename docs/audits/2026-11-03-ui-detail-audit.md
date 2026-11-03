# UI detail audit — 2026-11-03

The audit covers the homepage and scan console, hosted and standalone reports,
root profiles, historical summaries, disposable reports, knowledge indexes, sections
and articles, monitoring forms/dialog/status pages, and error states. The existing
purple/lime identity, themes, metadata and scan-to-report transition remain in place.

## Findings and resolutions

- **[P1] Compact IDs wrapped inside cards.** The baseline browser audit reproduced
  `B4`/`B5` wrapping at 320px and `B2`/`B4`/`B5` at 1280px. Flexible headings and
  inherited word breaking could squeeze a badge. Badges now resist shrinking and
  wrapping; catalog identifiers share an atomic inline recipe. Titles have their own
  flexible text spans. Long prose and code retain their appropriate wrapping rules.
- **[P2] Form layout followed viewport width instead of usable space.** Nested tablet
  monitoring forms could squeeze email inputs. Hero and monitoring controls now use
  container queries, minimum control heights and flexible text. Dialog close controls
  have a dedicated, sticky row and receive initial focus so opening a dialog does
  not summon the mobile keyboard automatically. The close action stays reachable
  when enlarged content scrolls.
- **[P2] Enlarged text crowded report rows.** Verdicts, code IDs and actions competed
  for a narrow column. Detailed checks and knowledge rows now stack their content
  when their container is narrow; group scores have their own fallback row. Verdict
  counts wrap as complete units. Long actions can grow vertically. Hero and history
  level summaries also reflow without clipping their text.
- **[P2] Overview layouts were uneven.** The third score card now spans the tablet
  row; wider layouts use three equal cards. The check map retains its named transition
  and switches between compact and labeled rows according to available space. Labels
  and scores stay aligned while cells wrap within their track.
- **[P2] Spacing varied between equivalent surfaces.** Primary panels share 16px mobile
  and 24px wider-screen insets; compact cards use 16px. Hidden scan-console markup no
  longer adds an extra 44px above the homepage's first visible section. Major home
  sections use a 40px separation; live progress has its own explicit separation.
- **[P2] Hover and focus treatments overlapped or disappeared.** Knowledge cells now
  move slightly and use an outline without growing over adjacent cells. Gaps and
  corner radii match report cells. Completed arrival animations release the transform
  property so hover/focus feedback still works. Disclosure focus outlines stay inside
  clipped card frames. Shared focus defaults cover native controls and text links.
- **[P2] Wide examples needed consistent keyboard access.** Article, fix and report
  code blocks share one treatment and can receive focus for scrolling. Reference and
  history tables keep horizontal scrolling in a labeled region. Long URLs remain
  readable within page boundaries.
- **[P3] Secondary type and controls drifted.** Body, secondary paragraphs, metadata,
  code and panel headings now follow the shared role scale. Level labels agree across
  reports/history. Textareas use 16px text on phones, and filter chips have the same
  44px minimum target height as other controls.

## Shared rules

The implementation lives in [the UI package](../../packages/ui/README.md), particularly
`recipes.ts` and `surfaces.css`. Component-specific check-map motion remains with the
report renderer; knowledge navigation remains with the knowledge renderer.

- Use `identifier` for compact catalog/group IDs and `badge()` for status/tier pills.
- Use `panel` for primary card insets. Compact cards and dense disclosure rows have
  explicit, documented spacing rather than unrelated intermediate padding values.
- Keep body text at 16px/24px, prose at 16px/28px, secondary paragraphs at 14px/24px,
  dense labels at 14px/20px, and metadata at 12px/20px. Cards use 16px headings,
  major sections 18px, and article sections 20px. Display typography remains fluid.
- Buttons have a 44px minimum height and grow for wrapped text; hero fields use a
  52px minimum. Field text, inset and chevron placement share the input recipe.
- Interactive map cells are 24px at default text size; legend symbols are smaller
  decoration. Keyboard focus remains distinct from verdict/selection colour.
- Reflow according to the containing component's available width. Keep real tables
  and preformatted code in their own scroll regions.

## Verification

- **644 baseline matrix cases:** 23 routes at 320, 375, 414, 639, 640, 767, 768,
  799, 800, 1023, 1024, 1280, 1440 and 1920px in both themes. No page-level
  horizontal overflow, wrapped catalog IDs or control-text padding collisions.
  Routes include three report verdict mixes, profiles, history, knowledge pages,
  all five monitoring status states, errors, long URLs, disposable and standalone
  reports, and the no-JavaScript homepage (which retains its static dark fallback).
- **200% text:** 32 cases across eight page families at 320, 375, 768 and 1280px,
  including expanded report groups, fixes and evidence. This found one squeezed
  article action; after correction, 84 normal-size knowledge cases and 16 enlarged
  knowledge cases passed in both themes.
- **34 final targeted cases:** home/footer at normal and 200% text, plus home,
  report and article at 844×390, 1024×600 and 1920×1080 in both themes. No detected
  overflow, identifier wrapping or control-text padding collisions.
- **Dialog and controls:** monitoring inputs/actions align at 44px with 16px text
  at 320, 375, 640, 768 and 1280px. At 320px and 200% text, keyboard navigation
  scrolls the content while the close button remains inside the visible dialog.
- **Interaction checks:** knowledge search and priority filters update the visible
  count correctly. Keyboard focus on a 24px knowledge cell uses a visible outline
  and a 2px translation without scaling over adjacent targets. Code/table regions
  remain keyboard reachable. The real fixture-backed scan handoff is checked in
  the browser; check-map and level-badge transition names and arrival logic remain
  unchanged.
- **Quality gate:** `pnpm check` passes, including formatting, repository rules,
  build, lint, types, tests, catalog validation and generated-document parity. A
  separate holistic code review was completed and its actionable findings resolved.

These checks exercise the current embedded browser and representative content;
they are evidence of the audited layouts, rather than a claim about every possible
browser, translation or future content string. No dependencies or scanning rules
were changed for this visual audit.
