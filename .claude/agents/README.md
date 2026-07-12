# DevDigest Agents

Custom Claude Code subagents for the DevDigest project. Each agent is a Markdown file with YAML
frontmatter (`name`, `description`, `model`, `tools`, optional `skills:`) plus a system-prompt body.
Claude routes work to an agent based on its `description`, so the descriptions are written as
trigger rules ("Use proactively when…").

| Agent | Model | Role | Writes code? |
|-------|-------|------|--------------|
| [`researcher`](./researcher.md) | sonnet | Read-only research (project + internet), strict structured output | No |
| [`implementation-planner`](./implementation-planner.md) | opus | Read-only architect — reviews requirements, confirms execution mode, produces a structured Implementation Plan | No (only the plan file) |
| [`implementer`](./implementer.md) | sonnet | Implements ONE task from a plan (backend or UI), self-verifies | Yes |
| [`test-writer`](./test-writer.md) | sonnet | Writes unit + integration tests (backend + reviewer-core), self-verifies | Yes |
| [`architecture-reviewer`](./architecture-reviewer.md) | sonnet | Read-only structural/architecture review of a diff or file set | No |
| [`plan-verifier`](./plan-verifier.md) | sonnet | Read-only requirements-completion / traceability check | No |
| [`doc-writer`](./doc-writer.md) | sonnet | Writes documentation (Diátaxis + Mermaid), knows where docs belong | Yes |
| [`spec-creator`](./spec-creator.md) | opus | Writes/updates Spec-Driven Development specs (EARS acceptance criteria), analyzes pasted designs for gaps, Q&A-first | Yes (only `specs/`) |

## Intended workflow

```
you / main session
   └─ spec-creator (opus, writes only specs/) → specs/SPEC-NN-<feature>.md   [optional, for features
         (Q&A-first: clarifies + analyzes any pasted design before writing)   worth a spec]
         └─ implementation-planner (opus, read-only) → docs/plans/<feature>.md
               (requirements review + execution-mode confirmation, then phased tasks with
                Type · Skills · Owned paths · Depends-on · Acceptance)
               └─ N× implementer (sonnet, parallel or sequential per confirmed mode) — one task each, inside its Owned paths
                     └─ plan-verifier (opus, read-only) — cheap completeness gate BEFORE the costly reviews
                     │     ├─ FAIL / partial → fix with a targeted implementer task → re-run plan-verifier
                     │     └─ PASS / review  ↓
                     ├─ architecture-reviewer + test-writer (fresh context; independent, run in parallel)
                     │     (plan-verifier's Pass-2 "test coverage" gaps are handed to test-writer as input)
                     └─ pr-self-review (existing skill) — final gate before push
```

**Why `plan-verifier` runs first.** It is the cheapest check in the chain (read-only, targeted
grep→glob→read), while `architecture-reviewer` (opus, reads the whole diff + all doctrine docs) is
expensive. There is no point paying for a structural review of code that isn't fully implemented
yet — so verify completeness first, close any `missing`/`partial` gaps with a small implementer
task, and only then spend the reviewers. `plan-verifier`'s Pass-2 already surfaces test-coverage
gaps, which feed `test-writer` directly instead of it re-discovering them. A second `plan-verifier`
pass at the very end is optional — worth it only if `test-writer`/`architecture-reviewer` touched
files that affect acceptance criteria, not as a reflexive re-run.

**Closing the Spec → Plan → Code loop.** When a spec exists, after `plan-verifier` reports PASS,
re-invoke `spec-creator` once to fill the spec's `Planned in` link (→ `docs/plans/<feature>.md`) and,
with human confirmation, propose `Status: implemented`. No other agent writes to `specs/`, so this
back-edit is the only thing that keeps traceability bidirectional.

Not every change needs a spec — `spec-creator` is a step ahead of `implementation-planner` for
features that meet the bar in `specs/README.md` (cross-module impact, nontrivial edge cases). When a
spec exists, it becomes the requirements input `implementation-planner` reviews instead of an ad-hoc
ask.

The pipeline mirrors Claude Code's recommended **Explore → Plan → Implement → Commit** loop: the
implementation-planner runs read-only during Plan, the implementers run during Implement, and review
stays a separate fresh-context step.

---

## `researcher`

Pre-existing read-only research agent. Finds information inside the project or on the public
internet and returns it in a strict template. Never edits files, never runs deep-research. The
implementation-planner and implementer both follow its writing conventions (YAML frontmatter + Hard
rules + fixed output template).

---

## `implementation-planner`

**What it does.** Reviews the requirements it's given (never authors a specification), asks
clarifying questions and surfaces recommendations when the requirements are unclear or could be
satisfied more simply, confirms with the user whether the plan should target multi-agent (parallel)
or single-agent (sequential) execution, and then turns the request into a structured, file-specific
**Implementation Plan** written to `docs/plans/<feature>.md`. Knows every DevDigest module
(`server/`, `client/`, `reviewer-core/`, `e2e/`, `@devdigest/shared`) and assigns each task a `Type`,
a skill set, `Owned paths` (non-overlapping when the mode is multi-agent), dependencies (a DAG),
known gotchas from module insights, and measurable acceptance criteria. Read-only except for the
plan file.

**Carries the full skill set.** It preloads the same skills the implementer uses (backend + UI +
core practices) plus `mermaid-diagram`, on purpose: it plans the implementation, so every practice
an implementer must follow has to be reflected in the plan.

**Based on:**

- **`description` as the routing signal**, written as a trigger rule — [Claude Code subagents docs](https://code.claude.com/docs/en/sub-agents), [Best practices for Claude Code subagents (PubNub)](https://www.pubnub.com/blog/best-practices-for-claude-code-sub-agents/)
- **Read-only planning, separated from implementation** (Explore → Plan → Implement) — [Best practices for Claude Code](https://code.claude.com/docs/en/best-practices); modelled on the built-in `Plan` subagent — [subagents docs](https://code.claude.com/docs/en/sub-agents)
- **Opus for design/architecture** (model tiering) — [wshobson/agents](https://github.com/wshobson/agents)
- **Handoff via a written plan artifact** — [Best practices for Claude Code](https://code.claude.com/docs/en/best-practices)
- **Strong plan structure** (overview, requirements, file-specific steps, phases, dependencies, testing, risks, success criteria) — [affaan-m/everything-claude-code · planner.md](https://github.com/affaan-m/everything-claude-code/blob/main/agents/planner.md)
- **Plan anti-patterns → the Red-flags check** (measurable acceptance, every requirement maps to a task, dependencies form a DAG) — [Strategic Task Planner (subagents.app)](https://subagents.app/agents/planner)
- **Preloading skills via the `skills:` field** (full skill body injected at startup) — [Extend Claude with skills](https://code.claude.com/docs/en/skills)
- **Delegating heavy discovery to a subagent** to keep planning context clean — [subagents docs](https://code.claude.com/docs/en/sub-agents)
- **Module-scoped insights** (read `<module>/insights/` rather than the whole repo) — project convention in [`/CLAUDE.md`](../../CLAUDE.md) "Read When", combined with the nested-skills pattern from [Extend Claude with skills](https://code.claude.com/docs/en/skills)

---

## `implementer`

**What it does.** Implements exactly one task from an Implementation Plan — backend (Fastify/Drizzle/
onion) or UI (Next.js/React) — and brings it to green. Runs in parallel with other implementers on
the **same branch** (no worktree isolation), so staying inside the task's `Owned paths` is what
keeps the parallel run safe. Its self-check is narrow: write the code and make the module's existing
tests + typecheck pass; broad review is left to `pr-self-review`.

**Skill routing.** All relevant skills (backend + UI + core + always) are listed in the `skills:`
frontmatter and injected at startup, so nothing has to be invoked manually. The body just states
which set to emphasise per task `Type`.

**Based on:**

- **`description` as a trigger rule** for auto-delegation — [Claude Code subagents docs](https://code.claude.com/docs/en/sub-agents)
- **Sonnet for implementation** (model tiering) — [wshobson/agents](https://github.com/wshobson/agents)
- **Per-type skill sets injected via `skills:`** (backend vs UI vs core) — [Extend Claude with skills](https://code.claude.com/docs/en/skills)
- **Owned paths / forbidden files / contracts-first** for safe parallel work — [Parallel Claude Code Agents: Safe Workflow Guide](https://www.aakashx.com/blog/parallel-claude-code-agents/)
- **Self-verification with a runnable check** (tests + typecheck, iterate to green) — [Best practices for Claude Code](https://code.claude.com/docs/en/best-practices)
- **Review in a fresh context, separate from the author** — [Best practices for Claude Code](https://code.claude.com/docs/en/best-practices); kept in the existing `pr-self-review` skill rather than baked into this agent
- **Single-responsibility agent design** (one task, in scope) — [wshobson/agents](https://github.com/wshobson/agents), [PubNub best practices](https://www.pubnub.com/blog/best-practices-for-claude-code-sub-agents/)
- **Module-scoped insights read before coding, written back after** — project convention in [`/CLAUDE.md`](../../CLAUDE.md) + the `engineering-insights` skill

**Deliberately not used:** `isolation: worktree` (the project runs implementers on the main branch
by choice, relying on `Owned paths` discipline instead of worktree isolation).

---

## `test-writer`

**What it does.** Adds or extends unit and integration tests for the DevDigest backend (`server/`)
and the LLM review engine (`reviewer-core/`). It enforces the project's test split (`*.it.test.ts`
= real Postgres via testcontainers with transaction-rollback isolation; `*.test.ts` = hermetic unit
with fake timers and seeded ids), injects a `FakeLlmProvider` at the `LLMProvider` seam for
reviewer-core tests, and never modifies production `src/` files (only a type export strictly
required to compile a test is permitted). Forbidden anti-patterns are encoded directly in its body:
tautological assertions, over-mocking, snapshot tests on dynamic output, and non-deterministic test
bodies. Self-verifies by running the affected suites and pasting terminal evidence before reporting
done.

**Skill routing.** `react-testing-library` supplies RTL and vitest query conventions; `fastify-best-practices`,
`drizzle-orm-patterns`, and `onion-architecture` anchor the backend test structure to the actual layering;
`zod` and `typescript-expert` cover schema-level assertions; `security` and `engineering-insights`
are the always-on set.

**Based on:**

- **Subagent design and trigger-rule `description`** — [Claude Code subagents docs](https://code.claude.com/docs/en/sub-agents), [Best practices for Claude Code subagents (PubNub)](https://www.pubnub.com/blog/best-practices-for-claude-code-sub-agents/)
- **Over-mocking and tautological-test study** — [Are Coding Agents Generating Over-Mocked Tests? (arXiv)](https://arxiv.org/html/2602.00409v1)
- **Tautological-test postmortem (contract-comment-before-assertion rule)** — [When AI-generated tests pass but miss the bug (dev.to)](https://dev.to/jamesdev4123/when-ai-generated-tests-pass-but-miss-the-bug-a-postmortem-on-tautological-unit-tests-2ajp)
- **Mocking LLM calls for deterministic tests** — [Unit testing AI agents: mocking LLM calls (CallSphere)](https://callsphere.ai/blog/unit-testing-ai-agents-mocking-llm-calls-deterministic-tests)
- **Blazing-fast Postgres tests with testcontainers + Vitest** — [Blazing fast Prisma and Postgres tests in Vitest (Codepunkt)](https://codepunkt.de/writing/blazing-fast-prisma-and-postgres-tests-in-vitest/)
- **Flaky-test prevention in Vitest** — [Flaky tests in Vitest (Mergify)](https://mergify.com/flaky-tests/vitest/)

---

## `architecture-reviewer`

**What it does.** A **read-only** structural auditor (`tools: Read, Glob, Grep` — no `Edit`,
`Write`, or `Bash`). Given a diff or file set, it reads the project's own authoritative docs first
(`CLAUDE.md`, `server/CLAUDE.md`, `server/docs/architecture.md`, `reviewer-core/CLAUDE.md`,
`reviewer-core/docs/pipeline.md`) and then checks seven named rules: inward-only dependencies,
business logic in routes, DI discipline, no `process.env` outside `LocalSecretsProvider`,
`reviewer-core` zero-I/O, `groundFindings()` gate, and shared-contract deduplication. Every finding
must cite the exact rule it violates; uncited generic opinions are suppressed. Write tools are
deliberately omitted — a reviewer that can write is tempted to fix rather than report, which destroys
review independence.

**Scope.** Does NOT review style nits, naming, runtime bugs, test quality, performance, or security
injection vectors (those belong to `pr-self-review` and the `security` skill). Structural contracts
only.

**Based on:**

- **Subagent design and trigger-rule `description`** — [Claude Code subagents docs](https://code.claude.com/docs/en/sub-agents), [Best practices for Claude Code subagents (PubNub)](https://www.pubnub.com/blog/best-practices-for-claude-code-sub-agents/)
- **Parallel AI agents for code review** — [9 Parallel AI Agents That Review My Code (HAMY)](https://hamy.xyz/blog/2026-02_code-reviews-claude-subagents)
- **Architectural liquefaction and the need for automated guardrails** — [Clean Architecture in the Age of AI (dev.to)](https://dev.to/uxter/clean-architecture-in-the-age-of-ai-preventing-architectural-liquefaction-5d8d)
- **Enforcing Clean Architecture via tooling** — [Enforce Clean Architecture in TypeScript with fresh-onion (dev.to)](https://dev.to/remojansen/enforce-clean-architecture-in-your-typescript-projects-with-fresh-onion-45pi)
- **Agentic code review patterns** — [Agentic Code Review (Addy Osmani)](https://addyosmani.com/blog/agentic-code-review/)

---

## `plan-verifier`

**What it does.** A **read-only** completeness checker (`tools: Read, Glob, Grep, Bash` — no
`Edit` or `Write`). Given an Implementation Plan, it walks every requirement and acceptance criterion,
searches for the concrete implementing artifact (grep → structural glob → read), quotes verbatim
evidence, and assigns one of four statuses: `done | partial | missing | cannot-verify`. `Bash` is
used only to run grep/typecheck commands and capture output as evidence — never to modify state.
After the per-requirement pass it performs an implicit-concerns sweep (error handling, auth,
idempotency, test coverage, type safety). Output is a traceability matrix table followed by a gate
verdict.

**Skill routing.** The skill set is intentionally lean: `typescript-expert` to locate TypeScript
artifacts, `onion-architecture` to know where backend artifacts should live, and
`frontend-architecture` to locate UI artifacts. No architecture-quality or security skills are
loaded — those concerns belong to `architecture-reviewer` and `pr-self-review`. The body explicitly
states this agent's mandate is completeness and traceability only.

**Based on:**

- **Spec-driven development with AI** — [Spec-Driven Development with Agentic AI (ArceApps)](https://arceapps.com/blog/spec-driven-development-ai/)
- **Writing acceptance criteria AI agents can verify** — [Acceptance criteria an AI agent can verify (BrainGrid)](https://www.braingrid.ai/blog/how-to-write-acceptance-criteria-ai-agent-can-verify)
- **Code search tool selection for AI agents** — [Code search for AI agents — which tool, when (ceaksan.com)](https://ceaksan.com/en/code-search-for-ai-agents-which-tool-when)
- **LLM behavioral failure modes (hallucination, rubber-stamping)** — [LLM behavioral failure modes (ceaksan.com)](https://ceaksan.com/en/llm-behavioral-failure-modes)
- **What AI verification still misses** — [AI coding agents can verify some of their work — here's what they still miss (dev.to)](https://dev.to/moonrunnerkc/ai-coding-agents-can-verify-some-of-their-work-now-heres-what-they-still-miss-58mc)
- **Requirements traceability matrix structure** — [How to create a traceability matrix (Perforce)](https://www.perforce.com/blog/alm/how-create-traceability-matrix)

---

## `doc-writer`

**What it does.** Writes and updates Markdown documentation for the DevDigest codebase. Every
claim is grounded in source (never invented); every doc is classified into a Diátaxis quadrant
(tutorial / how-to / reference / explanation) and placed according to the repo's layout decision
tree (`server/docs/`, `client/docs/`, `docs/adr/`, `docs/plans/`, `<module>/insights/`). ADRs are
append-only — accepted ones are never edited, only superseded. Every generated file is stamped with
`<!-- generated from: <source files> -->` on the second line. Mermaid diagrams are selected by
content type and validated with a post-check (unique node ids, no lowercase `end`, correct arrow
syntax) before publishing.

**Skill routing.** `mermaid-diagram` drives diagram type selection and syntax; `onion-architecture`
and `frontend-architecture` are loaded to accurately describe backend and UI module structure in
reference docs; `typescript-expert` enables accurate reading of TypeScript types and exported
symbols; `engineering-insights` closes the loop — doc-writing discoveries (undocumented constraints,
gotchas) are appended back to `<module>/insights/`.

**Based on:**

- **Diátaxis framework** — [Diátaxis — Start Here](https://diataxis.fr/start-here/)
- **Automated, grounded documentation generation (DocAgent)** — [DocAgent (arXiv)](https://arxiv.org/html/2504.08725v1)
- **AI doc generation: when it helps and when it misleads** — [AI can write your docs, but should it? (Mintlify)](https://www.mintlify.com/blog/ai-can-write-your-docs-but-should-it)
- **Architecture Decision Record conventions** — [Architecture Decision Record (Martin Fowler)](https://martinfowler.com/bliki/ArchitectureDecisionRecord.html)
- **ADR best practices** — [Master ADRs (AWS)](https://aws.amazon.com/blogs/architecture/master-architecture-decision-records-adrs-best-practices-for-effective-decision-making/)
- **Avoiding AI writing pitfalls** — [avoid-ai-writing SKILL.md (GitHub)](https://github.com/conorbronsdon/avoid-ai-writing/blob/main/SKILL.md)

---

## `spec-creator`

**What it does.** Writes and updates Spec-Driven Development (SDD) specifications in a single flat
`specs/` folder at the repo root (`specs/SPEC-NN-<feature>.md`, naskrizna numbering via `max+1`).
Every acceptance criterion is written as one of five EARS patterns (ubiquitous / event-driven /
state-driven / unwanted-behavior / optional-feature) plus a behavior-level verification hint, so it
collapses into a single testable statement instead of a vague adjective. When the user pastes or
points to design material, it actively hunts for what the design *doesn't* show — missing corner
cases, undefined cross-module communication, UX gaps — and turns every gap into a clarifying
question or proposal. It is **Q&A-first**: all open questions are asked and answered in chat before
any file is written, so a finished spec should not normally carry an unresolved
`[NEEDS CLARIFICATION: …]`. Specs are living documents — there is no "supersedes" relationship; an
existing spec is edited in place and every change (including status changes) is appended to its
`## Changelog`. `Status` transitions (`draft` → `approved` → `implemented`) can be *proposed* by the
agent (backed by a `Grep` spot-check per AC) but require explicit human confirmation before the
field is edited. A `Planned in` header line tracks the link to an Implementation Plan once one
exists, so Spec → Plan → Code stays traceable in both directions. Every draft runs a Self-check
checklist (EARS validity, no code leakage, numbering, Non-functional coverage, Changelog, Status
gate) before it's saved.

**Scope lock.** `tools: Read, Glob, Grep, Write, Edit, Agent` — no `Bash`. The only paths it may
write to are `specs/*.md` and `specs/README.md`; this is enforced by instruction in its own body
(soft constraint), not by a hook. `Agent` is scoped to delegating to `researcher` only (never to
`implementer`/`implementation-planner`), for information the local docs/insights/code don't have —
it may fan out multiple `researcher` calls in parallel and keep the raw research out of its own
context. Design sources are never fetched or invented — the user supplies them in the conversation
or as a local file path. A spec may describe diagrams, workflows, cross-service communication, and
contract shapes (field names/types/validation intent) — it may never contain implementation detail
(file paths to create, function names, code snippets, library choices); that line is enforced
explicitly in the agent's Hard rules, including an explicit warning that the `zod`/`security` skills
will surface code-shaped examples that must be translated to prose, never pasted verbatim.

**Skill routing.** `onion-architecture` and `frontend-architecture` let it reason accurately about
which module owns what and how modules actually talk to each other when analyzing a design's
cross-module gaps. `mermaid-diagram` covers workflow/sequence diagrams. `zod` lets it describe
contract shapes precisely (and name existing `@devdigest/shared` contracts) without writing schema
code. `security` grounds the `Non-functional` and `Untrusted inputs` sections in concrete OWASP
concerns instead of "should be secure." `typescript-expert` is for spot-checking `Status: implemented`
proposals — reading existing types/routes accurately before citing them as evidence. `zod` and
`security` surface code-shaped examples; the agent's own Hard rules require translating those into
prose/tables, never pasting the syntax into a spec. `<module>/insights/gotchas.md` and
`INSIGHTS.md` are read directly (via `Read`, no skill needed) as the primary source for
`## Edge cases` — no skill is loaded for this since the agent only ever reads them, never writes.

**Pre-existing `<module>/specs/` folders.** `client/specs/`, `server/specs/`, `reviewer-core/specs/`,
and `e2e/specs/` already existed before this agent and hold a different, older kind of document —
technical flow descriptions (`review-flow.md`, `pages.md`, `grounding-spec.md`, e2e `*.flow.json`),
not SDD specs. `spec-creator` treats them as read-only grounding context and never writes into them;
its only write target is the root `specs/` folder, which is documented in `specs/README.md`.

**Based on:**

- **EARS (Easy Approach to Requirements Syntax)** — Alistair Mavin et al., Rolls-Royce, 2009;
  adopted here because each of the five patterns collapses a requirement into one unambiguous,
  testable statement (trigger + reaction), which is what an `implementer` or `plan-verifier` needs
  to check work against.
- **Spec-driven development with agentic AI** — same source underpinning `plan-verifier`'s
  traceability approach: [Spec-Driven Development with Agentic AI (ArceApps)](https://arceapps.com/blog/spec-driven-development-ai/)
- **`description` as a trigger rule for proactive routing** — [Claude Code subagents docs](https://code.claude.com/docs/en/sub-agents)
- **Read-only-until-confirmed drafting (Q&A-first)** — mirrors `implementation-planner`'s
  "Clarify & recommend" step, applied one layer earlier in the pipeline (spec, not plan)
- **Untrusted-input boundary carried into spec content** — same `wrapUntrusted()` seam documented in
  `reviewer-core/docs/pipeline.md`, so specs for features that read PR/issue/commit text explicitly
  flag that content as data, not instructions

---

## Adding a new agent

1. Create `<name>.md` here with frontmatter (`name`, `description`, `model`, `tools`, optional
   `skills:`).
2. Write the `description` as a trigger rule — it is the only signal Claude uses to route to the agent.
3. If you preload skills, make sure none of them set `disable-model-invocation: true` (that blocks
   preloading).
4. Add a row to the table above and a section here, with sources if the design is based on external
   practices.
