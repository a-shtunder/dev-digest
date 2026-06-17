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

## Open Questions
