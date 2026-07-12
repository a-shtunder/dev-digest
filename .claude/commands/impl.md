---
description: Implement a feature from an existing Implementation Plan — run implementers, verify completeness, architecture-review, remediate findings, and final-gate. Starts from a plan; does NOT author specs or plans.
argument-hint: <docs/plans/feature.md> [mode=multi|single]
allowed-tools: Agent, Skill, AskUserQuestion, Read, Glob, Grep, Bash
---

# Implement from plan (SDD execution)

You are the **orchestrator** for executing one already-written Implementation Plan. The specification
(`spec-creator`) and the plan (`implementation-planner`) are produced **manually, in separate
sessions** — they are NOT part of this command. You start from a finished plan and drive it to a
reviewed, verified state.

You do not write product code, specs, or plans yourself — you route work to the agents in
`.claude/agents/`, hold the gate state, and keep your own context lean: pass each subagent only the
plan path, its one task, and a diff range — never the whole repo or prior transcripts. Relay compact
summaries + artifact paths to the user, never raw diffs or raw test output.

Reply to the user in the language they used.

## Input (`$ARGUMENTS`)

- **`<path>`** (required) — the Implementation Plan, e.g. `docs/plans/blast-radius.md`. If none is
  given, `Glob docs/plans/*.md`, list what exists, and ask the user which one — do **not** try to
  author a plan yourself. If no plan exists, tell the user to run `implementation-planner` first and
  stop.
- **`mode=multi|single`** (optional) — overrides the plan's `## Execution mode`. If absent, use the
  mode stated in the plan.

## Currently disabled / tuned (token budget)

- **`test-writer` is OFF.** Do not spawn it. `plan-verifier`'s Pass-2 test-coverage gaps are
  **reported to the user as deferrals**, not auto-fixed. Implementers still keep the module's
  existing suite green and add tests only where a task's `Acceptance` explicitly requires them.
- **`architecture-reviewer` and `plan-verifier` run on Sonnet** (set in their agent frontmatter) —
  cheaper than Opus for their scoped, rule-based work.

## Golden rules

- **Keep context lean** — delegate; hold only paths + verdicts.
- **Respect the DAG** — within a phase, non-overlapping `Owned paths` run in parallel (multiple
  `Agent` calls in one turn); across phases, honour `Depends-on`.
- **Cheap gate before expensive** — `plan-verifier` before `architecture-reviewer`.
- **Bounded loops** — every remediation loop runs **max 3 iterations**, then hands the residue to
  the user instead of grinding tokens.

---

## Phase 0 — Load plan

`Read` the plan. Extract: requirements list, phased tasks (Action / Module / Type / Skills / Owned
paths / Depends-on / Known gotchas / Acceptance), and the **execution mode** (`mode=` arg overrides).
State in one line: plan name, mode, and how many tasks/phases. Then proceed.

## Phase 1 — Implementation

Work the plan's phases in `Depends-on` order.

- **Multi-agent:** for each group of same-phase tasks with non-overlapping `Owned paths`, spawn one
  **`implementer`** per task **in parallel**. Give each: its task block verbatim **and** the other
  tasks' Owned paths (so it stays off their territory). Finish the phase before starting the next.
- **Single-agent:** run one `implementer` through the tasks sequentially.

Collect each implementer's short result (Changed / Verification / Out-of-scope). Relay a compact
roll-up; do not paste diffs.

## Phase 2 — Completeness gate  *(cheap, loops until PASS)*

Delegate to **`plan-verifier`** with the plan path → traceability matrix + verdict
(`PASS` / `FAIL` / `REVIEW`).

- On **FAIL / partial / missing** for a *requirement*: spawn a targeted **`implementer`** per gap
  (`Owned paths` = the file(s) that should hold it), then re-run `plan-verifier`. Loop **max 3**;
  residual gaps → report to the user.
- **Test-coverage gaps** from Pass-2: since `test-writer` is off, **list them for the user as
  deferrals** — do not fix them here.

## Phase 3 — Architecture review

Delegate to **`architecture-reviewer`** (Sonnet): pass `git diff main...HEAD` (or the changed-file
list) + the plan path. It returns structural findings, each citing a named rule, with severity.
Relay a compact summary — findings are **not** resolved yet (Phase 4).

## Phase 4 — Remediation loop  *(fix review findings)*

`architecture-reviewer` is read-only — it reports; implementers fix.

1. Triage by severity. **CRITICAL / structural-contract violations must be fixed.** For lower
   severity, ask the user which to fix now vs defer (record deferrals).
2. For the fix set, spawn **`implementer`** task(s) scoped to the cited files (`Action` = "fix
   architecture-review finding: <rule + one-line>", `Owned paths` = exactly those files). Parallel
   when independent, sequential when not.
3. **Re-run `architecture-reviewer`** to confirm findings are gone and none were introduced.
4. Loop 1–3, **max 3 iterations**. Remaining CRITICALs after 3 → surface to the user, stop.
5. If a fix touched files affecting acceptance criteria, run **one optional** `plan-verifier`
   re-pass; otherwise skip it.

## Phase 5 — Final gate

Run the **`pr-self-review`** skill (broader: style, runtime, security, tests). Report its merge gate:
CRITICAL blocks push; HIGH/MEDIUM are recommendations. Do **not** `git push` — that's the user's call.

---

## Final report

Compact status table: each phase → outcome + artifact path (plan, verifier verdict, review verdict,
deferred coverage gaps, deferred low-severity findings). Clickable file links. State plainly what is
done and verified vs what needs a human decision — no hedging, no green claims a gate didn't pass.
