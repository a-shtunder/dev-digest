# Insights — client

Non-obvious findings and gotchas. Add an entry whenever something surprised you,
so the next agent/session doesn't relearn it. Append-only — see the
`engineering-insights` skill for how entries are captured.

## What Works

- **2026-06-14** — `formatCost` (`src/lib/cost.ts`) distinguishes MISSING data (`null`/`undefined` → "—") from a genuine zero (`0` → "$0.00"), widens precision for sub-cent values (~2 sig figs), and trims trailing zeros to a 2dp floor ("$0.06" not "$0.060", "$0.0013" not "$0.00"). Reuse it for any per-run money display.

## What Doesn't Work

- **2026-06-17** — `Icon.Circle` does not exist in `@devdigest/ui` — causes "Element type is invalid" at runtime. Use `Icon.Dot` for a small filled circle. Evidence: `client/src/vendor/ui/icons.tsx`.
- **2026-06-17** — Barrel `index.ts` re-exports in Next.js must NOT include a `.js` extension (e.g. `export … from "./FindingsPopover.js"` → `Module not found`). Next.js/webpack resolves bare names; `.js` is an ESM-only convention that breaks the bundler here.
- **2026-06-17** — Popovers rendered inside a table row with `overflow: hidden` are clipped — `position: absolute` is not enough. Must use `createPortal(…, document.body)` with `position: fixed` and `getBoundingClientRect()` for viewport-relative placement. Evidence: `FindingsBadgeGroup.tsx`.

## Codebase Patterns

- **2026-06-17** — `FindingsHoverCard` renders its panel in a `createPortal(document.body)` with `position:fixed` (coords measured from the anchor's `getBoundingClientRect` on open, recomputed on resize, closed on scroll). This is the fix for the earlier `overflow:hidden` clipping limitation — the panel escapes any clipping ancestor. Because the panel is outside the anchor's subtree, BOTH the anchor and the portal panel carry the open/close mouse handlers (shared 120ms timer) so the pointer can cross the gap. Evidence: `client/src/components/FindingsHoverCard/FindingsHoverCard.tsx`.
- **2026-06-17** — Finding deep-linking: a findings popover navigates to `…/pulls/:number?tab=findings&finding=:id`. The PR-detail page reads `?finding`, forces the findings tab, and threads `focusFindingId` → `FindingsTab` (resolves finding→run, reuses the `targetRunId` open+scroll) → `ReviewRunAccordion` (opens if it owns the finding) → `FindingsPanel` (scrolls to `[data-finding-id]` + `defaultExpanded`). A finding's file:line link opens the PR's Files tab (`githubPrFilesUrl`), not the standalone blob. Evidence: `pulls/[number]/page.tsx`, `FindingsTab`, `ReviewRunAccordion`, `FindingsPanel`.

- **2026-06-18** — `BarChart2` and `GripVertical` do NOT exist in the `@devdigest/ui` icon registry. Use `BarChart` for charts and a unicode character (e.g. `⠿`) for drag handles. Always verify icon names against `client/src/vendor/ui/icons.tsx` before using them — a wrong name silently renders nothing because Icon is a proxy object.
- **2026-06-18** — The `AgentEditor` tab system has TWO places to update: `TABS` constant in `AgentEditor/constants.ts` (controls the tab bar) and `VALID_TABS` array in `agents/[id]/page.tsx` (validates the `?tab=` URL param). Both must be kept in sync when adding a tab — missing VALID_TABS causes the new tab to silently redirect to `config`. Evidence: `client/src/app/agents/[id]/_components/AgentEditor/constants.ts`, `client/src/app/agents/[id]/page.tsx:15`.

- **2026-06-14** — Cross-route shared components live in `src/components/<Name>/` with an `index.ts` barrel, imported via `@/components/<Name>` (e.g. `RunCostBadge`, `diff-viewer`). Vendored UI primitives (`Badge`, `CircularScore`) live in `src/vendor/ui` under `@devdigest/ui` — different home. Evidence: `client/src/components/RunCostBadge/`.
- **2026-06-14** — The PR-list table is driven by two parallel constants that MUST stay length-aligned: `COLUMN_KEYS` (header keys + order) and `GRID` (CSS grid-template tracks). Adding a column = add to both AND render a matching cell in `PRRow.tsx`, else header/cells misalign silently. Evidence: `client/src/app/repos/[repoId]/pulls/constants.ts`.
- **2026-06-14** — i18n has only the `en` locale (`client/messages/en/`); new UI strings need a key under the right namespace file (e.g. `prReview.json`, `runs.json`) read via `useTranslations("<ns>")`. A missing key renders the raw key, not an error.

## Tool & Library Notes

## Recurring Errors & Fixes

## Session Notes

### 2026-06-17
- Added per-severity findings criticality across all PR surfaces: Findings column in PR list (server-side grouped SQL count), severity filter pills in FindingsPanel, severity badges in Timeline and ReviewRunAccordion, expand-on-click in popovers.
- Consolidated `FindingsBadgeGroup` + `FindingsPopover` into one shared component (`pulls/_components/FindingsBadgeGroup/`) with two modes: static (findings array) and lazy (prId + counts, fetches on hover via `usePrReviews`).
- Decision: popovers close immediately on mouseleave (no delay); click-to-pin keeps them open. Hover-only with a delay gap was unreachable in practice.
- **Merge note (lesson-2-lab/skills → main):** lab2 built a parallel findings UI (`FindingsCountChips` + `FindingsHoverCard` + `FindingPreview`, full `Finding[]` eager) for the same surfaces. Per explicit decision, this `FindingsBadgeGroup` design (server-side counts + lazy fetch) was kept instead — the lab2 components and their `PrMeta.findings`/`timeline.findingsInRun`/`findingsPopover.header` weren't merged in.

### 2026-06-18
- Built Skills UI (L02): `lib/hooks/skills.ts`, `/skills` page + SkillsListView + SkillCard + ImportDrawer, `/skills/[id]` + SkillEditor with Config/Preview/Versions/Stats tabs, AgentEditor SkillsTab (HTML5 DnD reorder, checkbox link/unlink), nav SKILLS LAB section, i18n keys.
- Skills tab added to AgentEditor — both `constants.ts` (TABS) and `page.tsx` (VALID_TABS) updated.

## Open Questions
