# API Contract Reviewer

A review agent whose skills catch **breaking API changes** in a PR — the ones a
general reviewer waves through as "just a refactor". These files are the
human-readable originals; the DB is the source of truth at run time (see the
parent [`README.md`](../README.md)).

## Files
- [`agent-prompt.md`](./agent-prompt.md) — the agent's `system_prompt`.
- Skills (each directive, with a good/bad example — importable as-is):
  - [`breaking-change.md`](./breaking-change.md)
  - [`response-schema.md`](./response-schema.md)
  - [`semver-discipline.md`](./semver-discipline.md)
  - [`deprecation-policy.md`](./deprecation-policy.md)

## Setup (via the UI)
1. **Agents → New**. Name it `API Contract Reviewer`, paste `agent-prompt.md` into
   the system prompt, pick a capable model, leave strategy `single-pass`.
2. **Skills**: create the four skills above (type `convention`). Do at least one via
   **Skills → Import** (upload the `.md`) to exercise the import path; the H1 becomes
   the skill name. Make sure each is **enabled** — only enabled skills are injected.
3. **Agent → Skills tab**: link all four to the agent.

## Experiment: without skills vs with skills
Take (or open) a PR that renames a response field or changes a route/function
signature — e.g. `userName` → `name`, or removing a public parameter.

1. **Baseline** — unlink (or disable) the skills, run a review on the PR. The agent
   treats the change as a refactor and does not flag the broken contract.
2. **With skills** — link + enable the four skills, re-run on the same PR. The agent
   now flags the breaking change (CRITICAL), cites `file:line`, and names the
   downstream breakage.

The delta between the two runs is the demo: skills turn a miss into a caught
breaking change. Skill bodies are injected into the prompt automatically by
`server/src/modules/reviews/run-executor.ts` (fetches the agent's enabled linked
skills → `reviewPullRequest({ skills })` → rendered as `## Skills / rules`).
