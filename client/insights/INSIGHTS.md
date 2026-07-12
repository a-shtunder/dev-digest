# Client Insights

Non-obvious discoveries from real sessions. Specific and actionable — pass the cold-read test.
See also: `insights/gotchas.md` for known quirks at project start.

---

## What Works

2026-06-22 — `var(--ok)` is the correct CSS token for green/success icon color (used for check marks, approved verdict, "reviewed" status). Do NOT use `var(--success)` or `var(--green)` — those don't exist. Confirmed across settings, verdict banner, and PR list constants. ref: client/src/app/repos/[repoId]/pulls/[number]/_components/VerdictBanner/constants.ts:1

2026-06-22 — `Button` from `@devdigest/ui` auto-replaces the `icon` prop with a spinning `RefreshCw` when `loading=true`. Adding `icon="RefreshCw"` explicitly on a loading button is redundant — the component handles it. The spin animation runs via `ddspin 1s linear infinite` on the icon element. ref: client/src/vendor/ui/primitives/Button.tsx:24

2026-06-17 — `SEV[sev].c` from `@devdigest/ui` returns a hex string (e.g. `#ef4444`), NOT a CSS variable. Appending `"22"` / `"55"` gives valid 8-digit hex with ~13%/33% alpha — safe for `background` and `border` derivation. Do NOT use this trick with `var(--crit)` / `var(--warn)` style tokens (those are CSS vars and will produce invalid values). ref: client/src/app/repos/[repoId]/pulls/styles.ts:50

2026-06-17 — Shared display components for PR list cells live in `client/src/components/`. Pure display, no fetching. Accept `value | null | undefined`, render `–` for absent data. Pattern: `({ cost }: { cost?: number | null }) => cost && cost > 0 ? "$X.XXX" : "–"`. ref: client/src/components/RunCostBadge/RunCostBadge.tsx:1

2026-06-17 — Lazy-enable TanStack Query by passing `undefined` instead of a boolean flag: `usePrReviews(anchorRect && totalFindings > 0 ? pr.id : undefined)`. When `prId` is `undefined`, `enabled: !!prId` is false — no fetch fires. Query enables automatically when the condition becomes truthy. No conditional hook call needed. ref: client/src/app/repos/[repoId]/pulls/_components/PRRow/PRRow.tsx:28

2026-06-17 — Store `DOMRect | null` as hover state instead of `boolean` for popovers — gives both the trigger signal AND the position for `position: fixed` placement in one state value. Pattern: `onMouseEnter={(e) => setAnchorRect(e.currentTarget.getBoundingClientRect())}`. ref: client/src/app/repos/[repoId]/pulls/_components/PRRow/PRRow.tsx:34

2026-06-17 — `createPortal(content, document.body)` escapes `overflow: hidden` containers. Use for any overlay/popover rendered inside a clipped container. ref: client/src/app/repos/[repoId]/pulls/_components/FindingsPopover/FindingsPopover.tsx:96

2026-07-11 — `npx --yes agent-browser <cmd>` works for ad-hoc visual verification even though it's normally only wired up inside `e2e/` — no local install needed, npx fetches it on demand. It printed an `EBADENGINE` warning (`agent-browser@0.31.1` wants node>=24, repo runs node 20.15) but every command (`open`, `wait`, `screenshot`, `find ... click`, `eval`, `console --errors`) still worked correctly. Useful for implementers who need a quick "does this actually render" check without spinning up the full `./scripts/e2e.sh` flow. ref: client/src/app/repos/[repoId]/pulls/[number]/_components/OverviewTab/BlastRadiusCard.tsx:1

## What Doesn't Work

2026-06-18 — Fixing `.js` extensions in `client/src/vendor/shared/index.ts` alone is NOT enough. The individual contract files also import each other with `.js` extensions (`eval-ci.ts`, `observability.ts`, `platform.ts`, `productionize.ts`, `review-api.ts`, `adapters.ts`). All 6 must be fixed in addition to the barrel. Grep: `from '\./.*\.js'` in `client/src/vendor/shared/` to find them all. ref: client/src/vendor/shared/contracts/eval-ci.ts:2

2026-06-18 — `client/src/vendor/shared/index.ts` used `.js` extensions on all re-exports (`export * from './contracts/findings.js'`). This is the TypeScript ESM convention for Node.js but Next.js/webpack cannot resolve it — "Module not found: Can't resolve './contracts/findings.js'". The bug was latent: `import type` is erased at compile time so webpack never resolved the module. It surfaced only when `Severity` was imported as a value. Fix: remove all `.js` extensions from the client barrel. ref: client/src/vendor/shared/index.ts:17

2026-06-18 — `SeverityChip` with "N dots total" (render exactly N circles) is visually wrong — it gives no sense of scale. The correct model is always 12 slots: first `min(count, 12)` render as a single merged solid segment (height=2px), the remaining (12-N) render as faded separate dots. Width of merged segment = `N * SLOT_W + (N-1) * GAP`. ref: client/src/components/SeverityChip/SeverityChip.tsx:1

2026-06-17 — `Icon.AlertCircle` does not exist in `@devdigest/ui` — runtime error "Element type is invalid: expected a string... but got undefined". Never guess icon names; check existing usages (`grep -oh "Icon\.[A-Za-z]*"`) to find what's available. ref: client/src/app/repos/[repoId]/pulls/_components/FindingsPopover/FindingsPopover.tsx:56

2026-07-11 — `agent-browser click "text=X"` fails with "Element not found" whenever the text appears in more than one place in the DOM (Playwright strict-mode ambiguity under the hood) — even a single visible match can still fail if the text is split across nested spans. `agent-browser find text "X" click` succeeds in the same situation — prefer `find text <value> click` over the `click "text=..."` shorthand when clicking by visible text. ref: client/src/app/repos/[repoId]/pulls/[number]/_components/OverviewTab/BlastRadiusCard.tsx:1

## Codebase Patterns

2026-06-22 — `OverviewTab.tsx` originally had a hardcoded English string `"Description"` as a `SectionLabel` child — violating the no-hardcoded-strings rule. This was fixed (migrated to `t("overview.descriptionLabel")`) when the `prId` prop was added in T8. Future implementers touching this file: the fix is already in place, don't revert it. ref: client/src/app/repos/[repoId]/pulls/[number]/_components/OverviewTab/OverviewTab.tsx:1

2026-06-17 — `tableCard` in `styles.ts` has `overflow: hidden` — any `position: absolute` child inside the PR list table is clipped. Popovers/tooltips inside the table must use `position: fixed` + `getBoundingClientRect()` for correct placement. ref: client/src/app/repos/[repoId]/pulls/styles.ts:103

2026-06-17 — `@devdigest/shared` in the client resolves to `./src/vendor/shared/` (client's OWN local copy), NOT to `../server/src/vendor/shared/`. `client/tsconfig.json` has `"@devdigest/shared": ["./src/vendor/shared/index.ts"]`. The `gotchas.md` says "resolves to ../server/src/vendor/shared" — that is wrong. When adding fields to any shared contract (e.g. `PrMeta`), BOTH `server/src/vendor/shared/contracts/platform.ts` AND `client/src/vendor/shared/contracts/platform.ts` must be updated independently. ref: client/tsconfig.json:1

2026-06-18 — `Severity` from `@devdigest/shared` is a Zod `z.enum()` exported as both a value and a type. Its `.enum` property (`Severity.enum.CRITICAL`) equals the string `'CRITICAL'` at runtime. Import it as a value (drop `import type`) to eliminate hardcoded severity strings in `FINDINGS_FIELDS`, `SEVERITY_FILTERS`, and comparison expressions — TypeScript resolves both the type and the runtime accessor from the same import. ref: client/src/vendor/shared/contracts/findings.ts:11

2026-06-17 — PR list column layout is controlled by two constants that MUST change in sync: `GRID` (CSS `grid-template-columns` string) and `COLUMN_KEYS` (string array of column identifiers) in `constants.ts`. Missing one causes misaligned headers/rows with no TypeScript error. ref: client/src/app/repos/[repoId]/pulls/constants.ts:1

2026-06-20 — `src/lib/` is structured into three groups: `hooks/` (React Query hooks by domain: settings, repos, pulls, context-files, agents, reviews, trace, repo-intel), `contexts/` (React providers: RepoProvider/useActiveRepo, ThemeProvider/useTheme, ToastProvider/useToast/notify, Providers composite), and `utils/` (pure functions with no React deps: githubUrls, modelLabel, featureModels). Each group has an `index.ts` barrel. `api.ts` and `types.ts` stay at `lib/` root as core infrastructure. ref: client/src/lib/contexts/index.ts:1

2026-06-20 — Team convention: use `@/` path alias for any import going 3+ levels up (`../../../`). Short relative paths (1–2 levels, same feature) are fine. The `@/` alias maps to `src/` via `client/tsconfig.json`. Deep relative paths like `../../../../../lib/hooks/reviews` are explicitly rejected — write `@/lib/hooks/reviews` instead. This is a preference, not a TS enforcement — the compiler accepts both. ref: client/tsconfig.json:1

2026-07-11 — On the PR detail page (`/repos/:repoId/pulls/:number`), `<main>` (rendered by `AppShell`) is the actual scroll container, not `window`/`document.body` — `document.body.scrollHeight` stays small (~600px) while `document.querySelector('main').scrollHeight` reports the real content height (e.g. 4000+px for a card with many rows). Any script driving this page (agent-browser `eval`, RTL, e2e) that needs to scroll must target `main`, not `window.scrollTo`. ref: client/src/components/app-shell/AppShell.tsx:1

## Tool & Library Notes

2026-06-20 — `pr-self-review` skill has two authoritative files that can drift: `SKILL.md` (step descriptions) and `rules/severity-levels.md` (severity definitions). They duplicate the test-coverage-gate rule — SKILL.md Step 6.5 is the source of truth; severity-levels.md must mirror it exactly. Gaps found: missing `< 20 lines changed` skip condition and `not-found.tsx` in the skip list. Always compare both files when editing either. ref: .claude/skills/pr-self-review/rules/severity-levels.md:58

2026-06-20 — `pr-self-review` Step 6.6 (`npm audit`) runs without a `cd` — in this monorepo (`client/`, `server/`, `reviewer-core/` each have their own `package.json`) the command must be scoped: if `client/package.json` in diff → `cd client && npm audit`; if `server/package.json` → `cd server && npm audit`. Running from repo root misses package-specific vulnerabilities. ref: .claude/skills/pr-self-review/SKILL.md:211

2026-06-20 — Sub-agent template in `pr-self-review` SKILL.md says `Use the \`<skill-name>\` skill` but does NOT say to use the Skill tool. Sub-agents reading this template may not know they need to call the Skill tool explicitly — they could skip loading skill rules and hallucinate the review criteria instead. Template must say `Call the Skill tool with skill: "<skill-name>"`. ref: .claude/skills/pr-self-review/SKILL.md:127

2026-06-18 — In RTL tests, `[style*="flex-direction: column"]` is too broad to assert "no SeverityChip rendered" — RunHistory's content wrapper also uses `flexDirection: column`, producing false positives. The reliable proxy for SeverityChip absence is `[style*="opacity: 0.2"]` (the faded dot elements), which is unique to that component. ref: client/src/app/repos/[repoId]/pulls/[number]/_components/RunHistory/RunHistory.test.tsx:110

## Recurring Errors & Fixes

2026-06-17 — `git add` on paths with square brackets (Next.js dynamic routes like `[repoId]`, `[number]`) fails in zsh with "no matches found: client/src/app/repos/[repoId]/..." — zsh glob-expands brackets before git sees them. Fix: always quote such paths: `git add "client/src/app/repos/[repoId]/pulls/..."`. ref: client/src/app/repos/[repoId]/pulls/constants.ts:1

2026-06-20 — `src/lib/hooks/reviews.ts` imports `notify` directly via `from "../toast"` (sibling relative path), NOT through any barrel. When moving `toast.tsx` into `lib/contexts/`, updating only `app/` consumers is not enough — files inside `lib/hooks/` have their own direct imports. Always grep inside `lib/hooks/*.ts` when relocating lib files. Fix: change to `from "../contexts/toast"`. ref: client/src/lib/hooks/reviews.ts:8

2026-06-20 — `src/components/showcase/Showcase.tsx` exports `Gallery`, not `Showcase` — despite the filename. Writing `export { Showcase } from "./showcase/Showcase"` in a barrel produces `TS2305: Module has no exported member 'Showcase'`. Fix: `export { Gallery } from "./showcase/Showcase"`. ref: client/src/components/showcase/Showcase.tsx:58

## Session Notes

2026-06-22 — T8 Intent card + OverviewTab wiring → created IntentCard.tsx (Card + SectionLabel + Button loading pattern, useIntent/useRecomputeIntent hooks, loading/error/empty states, i18n via prReview namespace); added `prId: string | null` to OverviewTab; passed prId from page.tsx; added intent + overview i18n keys to prReview.json; exported intent hooks from lib/hooks/index.ts barrel. Typecheck and all 32 tests green. Files: client/src/app/repos/[repoId]/pulls/[number]/_components/OverviewTab/IntentCard.tsx, client/src/app/repos/[repoId]/pulls/[number]/_components/OverviewTab/OverviewTab.tsx, client/src/app/repos/[repoId]/pulls/[number]/page.tsx, client/messages/en/prReview.json, client/src/lib/hooks/index.ts.

2026-06-17 — Run Cost Badge: added COST column to PR list → surfaced `@devdigest/shared` dual-copy trap (client has its own vendor copy, gotchas.md was wrong). Fixed by updating client's local platform.ts. Files: client/src/vendor/shared/contracts/platform.ts, client/src/app/repos/[repoId]/pulls/constants.ts, client/src/components/RunCostBadge/RunCostBadge.tsx.

2026-06-18 — Tests: SeverityChip.test.tsx (7 tests — null guard, counts, dot counts, cap at 12); RunHistory.test.tsx updated — removed obsolete `/5 blockers/` assertion (text replaced by chips), added 3 per-severity chip tests. All 32 client tests green. Commit 1a64a18. Files: client/src/components/SeverityChip/SeverityChip.test.tsx, client/src/app/repos/[repoId]/pulls/[number]/_components/RunHistory/RunHistory.test.tsx.

2026-06-18 — SeverityChip visual redesign + RunHistory chips: fixed dot model to 12-slot filled/faded pattern, added `findings_critical/warning/suggestion` to `RunSummary` via server JOIN, replaced "5 finding(s) · 4 blockers" text in RunHistory with SeverityChip components. Files: client/src/components/SeverityChip/SeverityChip.tsx, client/src/app/repos/[repoId]/pulls/[number]/_components/RunHistory/RunHistory.tsx, server/src/modules/reviews/repository/run.repo.ts, both vendor/shared/contracts/trace.ts.

2026-06-17 — Severity filter pills + findings hover popover: added severity pills to FindingsPanel (PR detail) and lazy-fetch popover to PR list rows. Zero server changes — all data already existed (`findings_critical/warning/suggestion` counts in PrMeta, full findings via `usePrReviews`). Files: client/src/app/repos/[repoId]/pulls/[number]/_components/FindingsPanel/FindingsPanel.tsx, client/src/app/repos/[repoId]/pulls/_components/FindingsPopover/FindingsPopover.tsx, client/src/app/repos/[repoId]/pulls/_components/PRRow/PRRow.tsx.

2026-06-20 — Frontend architecture refactor: split `hooks/core.ts` god-file into 4 domain files (settings/repos/pulls/context-files), reorganized `src/lib/` flat layout into `contexts/` + `utils/` subdirectories, added `src/components/index.ts` barrel. All 32 tests stayed green. Hidden issue: `reviews.ts` had a direct sibling import (`../toast`) that broke on move — caught by typecheck. Files: client/src/lib/hooks/, client/src/lib/contexts/, client/src/lib/utils/, client/src/components/index.ts.

2026-06-20 — pr-self-review skill audit: found 4 gaps — (1) severity-levels.md missing `< 20 lines changed` skip + `not-found.tsx` in HIGH test gate; (2) npm audit needs per-package `cd`; (3) sub-agent template unclear about Skill tool call. All 4 gaps fixed. Files: .claude/skills/pr-self-review/SKILL.md, .claude/skills/pr-self-review/rules/severity-levels.md.

2026-06-20 — `pr-self-review` uses `git diff $(git merge-base origin/main HEAD)...HEAD` — this only reviews **committed** changes in a feature branch. When run on `main` with HEAD = origin/main (e.g. after a merge, with unstaged changes), the diff is empty and the skill silently reports nothing. To test the skill, changes must be committed to a branch first. ref: .claude/skills/pr-self-review/SKILL.md:49

2026-07-11 — Blast Radius bugfix pass (post-review of T3): grouping by `viaSymbol` name alone silently merges callers across files whenever two changed files declare a same-named symbol (e.g. two files each exporting `handler`) — the shared contract `BlastCallerRow.viaFile` exists specifically to disambiguate; always filter on `c.viaSymbol === symbol.name && c.viaFile === symbol.file`, never name alone. ref: client/src/app/repos/[repoId]/pulls/[number]/_components/OverviewTab/blastViewModel.ts:9

2026-07-11 — `groupCallersBySymbol` intentionally stays "dumb" and returns ALL groups (including zero-caller ones) — the "only show symbols with real callers" policy belongs at the call site (`BlastRadiusCard.tsx`, one `.filter((g) => g.callers.length > 0)` right after calling it), not baked into the view-model function. This keeps the pure function reusable/testable without a display policy, and lets the stat row keep showing the TRUE total (`data.changedSymbols.length`) while Tree/Graph show only the meaningful subset. ref: client/src/app/repos/[repoId]/pulls/[number]/_components/OverviewTab/BlastRadiusCard.tsx:107

2026-07-11 — The "degraded + empty" case (e.g. `{ changedSymbols: [], callers: [], degraded: true, reason: 'no_data' }` — repo not indexed yet) needs its OWN early-return branch in `BlastRadiusBody`, checked BEFORE the generic `!data.degraded` empty-state branch. An early `if (isEmpty) return <EmptyState .../>` placed first makes the degraded badge/reason unreachable — confirmed live against `acme/payments-api` PR #482 (`no_data` reason), which previously only showed generic "No blast radius data" instead of "Partial index — No index data yet for this repo." ref: client/src/app/repos/[repoId]/pulls/[number]/_components/OverviewTab/BlastRadiusCard.tsx:73

2026-07-11 — `@devdigest/ui`'s `Icon` registry has no dedicated "symbol"/"caller" icons — picked `Code` for symbols and `CornerDownRight` for callers (arrow-into pattern), reusing existing `Globe`/`Clock` for endpoints/crons for consistency with the badges already in the file. Full icon list lives in `client/src/vendor/ui/icons.tsx` — check there before guessing a name (several intuitive names like `AlertCircle` don't exist, per earlier entry in this file). ref: client/src/vendor/ui/icons.tsx:86

2026-07-11 — Verified stat-row + Chip toggle layout live at narrow card width (~442px, the right column of the PR Overview two-column grid): `flexWrap: wrap` on the outer row causes the Chip toggle to drop to its own line below the stat icons rather than staying inline — this is expected/acceptable responsive behavior, not a bug, since the design only requires them "same row or adjacent" and the layout still reads as one compact block. ref: client/src/app/repos/[repoId]/pulls/[number]/_components/OverviewTab/BlastRadiusCard.tsx:126

2026-07-11 — T3 (L04 homework) Blast Radius card: added `hooks/blast.ts` (`useBlastRadius`, mirrors `usePullDetail`), `OverviewTab/blastViewModel.ts` (pure `groupCallersBySymbol`), `BlastTree.tsx` (disclosure list, `MonoLink` + `githubBlobUrl`, same pattern as `FindingCard.tsx`), `BlastGraph.tsx` (custom inline SVG, capped at 8 rendered callers/symbol, dumb component — parent decides empty-state copy), `BlastRadiusCard.tsx` (orchestrator, `IntentCard.tsx`-style inline styles); wired two new props (`repoFullName`, `headSha`) through `OverviewTab.tsx` and `page.tsx`; appended `sectionLabel`/`empty`/`degraded`/`priorPrs.stub` keys to `blast.json` (pre-existing `stat`/`view`/`callerCount`/`noDownstream`/`graph` keys untouched). Backend (`server/src/modules/blast/**`, `repo-intel` bugfixes) was already done by a sibling agent by the time this ran — confirmed via `GET /pulls/:id/blast-radius` against the live dev server, no mocking needed. Visually verified via `agent-browser` against real seeded data (repo `a-shtunder/dev-digest`, PR #7 for tree/graph toggle + caller GitHub links, PR #3 for endpoint badges, repo `acme/payments-api` PR #482 for the genuinely-empty `no_data` state) — all render correctly, zero console errors, GitHub blob link had correct owner/repo/sha/encoded-path/line-anchor. Typecheck + all 41 client tests green throughout. Files: client/src/lib/hooks/blast.ts, client/src/app/repos/[repoId]/pulls/[number]/_components/OverviewTab/{blastViewModel.ts,BlastTree.tsx,BlastGraph.tsx,BlastRadiusCard.tsx,OverviewTab.tsx}, client/src/app/repos/[repoId]/pulls/[number]/page.tsx, client/messages/en/blast.json, client/src/lib/hooks/index.ts.

2026-06-20 — To invoke `pr-self-review`, just call the Skill tool (or say "review my changes") — do NOT manually run `git diff` bash commands to collect the diff first. The skill's execution algorithm runs those commands itself internally. Manually pre-collecting diff before calling the skill is redundant and was explicitly corrected by the user. ref: .claude/skills/pr-self-review/SKILL.md:1

## Open Questions
