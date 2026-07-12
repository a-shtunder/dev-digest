# E2E Insights

Non-obvious discoveries from real sessions. Specific and actionable — pass the cold-read test.
See also: `insights/gotchas.md` for known quirks at project start.

---

## What Works

2026-07-12 — For AC-35 (Project Context headline scenario), a live "grounded finding" cannot be produced deterministically in agent-browser (no LLM, hermetic stack has no provider API key — `container.llm(agent.provider)` throws BEFORE the spec-read step in `runOneAgent`, so a real "Run" click never reaches the spec injection code at all). The working pattern: seed a pre-baked `agent_runs` + `run_traces` (+ `reviews` + `findings`) row set directly in `server/src/db/seed.ts`, mirroring exactly the shape `run-executor.ts` would persist (same `RunTrace` fields: `specs_read`, `specs_missing`, `prompt_assembly.specs` wrapped as `<untrusted source="spec-0">...</untrusted>`). The e2e flow then asserts on this persisted, deterministic trace via the normal UI (Agent runs tab → run trace drawer) — no route/component changes needed since T15's trace UI already renders `specs_read`/`specs_missing`/`prompt_assembly.specs`. ref: server/src/db/seed.ts:456

2026-07-12 — Real production data flow (for reference, not used by the e2e seed): `SimpleGitClient.clonePathFor(repo)` returns `<container.config.cloneDir>/<owner>/<repo>` — it does NOT depend on the `repos.clone_path` DB column at all. Project Context discovery/injection needs an actual git clone physically present on disk at that path; the demo seed's `repos.clonePath: null` and no real clone means Project Context's discovery list (T12 page, T13/T14 Context tabs) is legitimately empty/"not available" for the seeded repo. Do not try to make e2e assert on the discovery list without first creating a real clone fixture on disk — seeding a pre-baked trace (see above) sidesteps this entirely for the AC-35 flow. ref: server/src/adapters/git/simple-git.ts:37

## What Doesn't Work

2026-07-12 — Flow steps that do `wait --url /pulls` immediately followed by `find text "<PR title>" click` (no intermediate `wait --text` for that title) are measurably flaky in this environment under `./scripts/e2e.sh` — observed intermittent `Command failed: agent-browser find text ... click` on flows `04-pr-findings`, `05-pr-diff`, `08-smart-diff` across repeated hermetic runs (each has this exact pattern; none of them wait for the text to be visible before clicking). `02-repo-pulls-detail` has the identical scenario but inserts `{ "cmd": ["wait", "--text", "<title>"] }` right before the `find ... click` step and never failed across the same runs. Root cause likely the per-PR-detail GitHub "refresh" background fetch (real network 404s against api.github.com, ~200ms–7s each) adding latency/jank while the list is still settling. Fix pattern for any new flow that clicks a PR-list row by title: always add a `wait --text "<title>"` step immediately before the `find text "<title>" click` step. Confirmed fixing `09-project-context-invariant.flow.json` this way made it pass in 3/3 follow-up hermetic runs (vs. 1/2 before the fix). ref: e2e/specs/09-project-context-invariant.flow.json:1

## Codebase Patterns

2026-07-12 — Contrary to `e2e/docs/flows.md` (stale — describes a `flows/*.json` directory, `--url`/`--text`/`find`/`click` top-level commands, and manual registration in `run.ts`), the ACTUAL established convention (confirmed by reading `e2e/run.ts`, `e2e/README.md`, and every existing spec) is: flows live in `e2e/specs/NN-name.flow.json`, are auto-discovered by `readdirSync(SPECS_DIR).filter(f.endsWith('.flow.json')).sort()` — no manual registration step exists or is needed in `run.ts`. Each step is `{ "cmd": [...], "label": "...", "assert"?: { "stdoutIncludes": "..." } }`, and `cmd` is the literal `agent-browser` argv (e.g. `["find", "text", "<exact text>", "click"]`, `["wait", "--url", "..."]`, `["wait", "--load", "networkidle"]`). Follow `e2e/README.md` + existing `specs/*.flow.json` files over `e2e/docs/flows.md` when they conflict. ref: e2e/run.ts:53

2026-07-12 — None of the existing flows use `data-testid` selectors (contrary to `e2e/docs/flows.md`'s "prefer data-testid" guidance and `e2e/specs/coverage.md`'s "Add the `data-testid` attributes... before writing the flow"). Every flow uses `find text "<exact rendered text>" click` or `find role <role> click --name "<accessible name>"` (matching a button's `aria-label`/visible label) — e.g. `find role button click --name "Agent runs"`. This works because the app's UI strings are static and already unique per screen; no component in `FindingCard`, `RunTraceDrawer`, or `ReviewRunAccordion` has a `data-testid` today. Matched this convention for the new AC-35 flow rather than adding `data-testid`s, since text/role selectors were sufficient and precise (verified: `find role button click --name "Open run trace & logs"` — the aria-label comes from `client/messages/en/prReview.json`'s `timeline.openTrace` key on the `RunHistory` row button). ref: e2e/specs/09-project-context-invariant.flow.json:1

## Tool & Library Notes

2026-07-12 — `agent-browser@0.31.1` declares `engines.node >=24.0.0` but installs and runs fine under Node 20.15.0 with only an `EBADENGINE` warning (no functional issue observed across 4 full hermetic runs). `agent-browser install` downloads Chrome for Testing (~172MB) to `~/.agent-browser/browsers/` — one-time per machine, not per-run. ref: e2e/insights/gotchas.md:1

2026-07-12 — `cd e2e && pnpm install` is required before `./scripts/e2e.sh` / `npm test` will work if `e2e/node_modules` doesn't exist yet — `tsx` isn't on PATH otherwise and `npm test` fails immediately with `sh: tsx: command not found` (silent-ish; script still tears down cleanly with exit 1). Not documented in `e2e/README.md`'s "Run locally" section for the hermetic path specifically (only mentioned via `npm install && npm run e2e:hermetic` as an alternative, not as a hard prerequisite for `./scripts/e2e.sh` directly). ref: e2e/package.json:1

## Recurring Errors & Fixes

## Session Notes

2026-07-12 — T17 (project-context plan): added the AC-35 headline e2e flow (`e2e/specs/09-project-context-invariant.flow.json`) plus its seed fixture (`server/src/db/seed.ts`: PR #484 with a diff violating "api/ must not import db/ directly", Security Reviewer's `attachedDocPaths` set to `["specs/architecture.md"]`, and a pre-baked `agent_runs`/`run_traces`/`reviews`/`findings` row set — no live LLM call, per Risk R-8). Discovered the plan's assumed paths (`e2e/flows/*.json`, "register in `run.ts`") don't match the actual codebase convention (`e2e/specs/*.flow.json`, auto-discovered) — followed the real convention instead, confirmed via `e2e/README.md` + existing specs. Verified with 4 full `./scripts/e2e.sh` hermetic runs (real Docker Postgres + API + web + agent-browser/Chrome, no mocks) — flow 09 passed 4/4 after adding a `wait --text` step before the PR-row click (see What Doesn't Work). Files: e2e/specs/09-project-context-invariant.flow.json, e2e/README.md, server/src/db/seed.ts.

## Open Questions
