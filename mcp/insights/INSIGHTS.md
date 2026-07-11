# Mcp Insights

Non-obvious discoveries from real sessions. Specific and actionable — pass the cold-read test.
See also: `insights/gotchas.md` for known quirks at project start.

---

## What Works

2026-07-10 — Runtime smoke test pattern for this package: write a throwaway `.ts` file directly under `mcp/src/` (not `/tmp`) with relative imports (`./bootstrap.js`, `./context.js`) so `tsx` picks up `mcp/tsconfig.json`'s path aliases (`@server/*`, `@devdigest/shared`); run with `./node_modules/.bin/tsx src/tmp-smoke.ts`, then delete the file. Confirmed working end-to-end against a live seeded Postgres via `getContainer()`. ref: mcp/src/bootstrap.ts:13

## What Doesn't Work

2026-07-10 — `resolveRepo(container, workspaceId, name)` fails with the `repos.name` column (e.g. `"payments-api"`) — that column is just the repo's short name, not the `"owner/name"` identifier the MCP tools' `repo` argument expects. Must pass `repos.fullName` (e.g. `"acme/payments-api"`), which is what `RepoService.getByFullName` actually queries against. ref: server/src/db/schema/repos.ts:13-14

## Codebase Patterns

## Tool & Library Notes

## Recurring Errors & Fixes

## Session Notes

2026-07-10 — Implemented the 4 read-only MCP tool registrars (`devdigest_list_agents`, `devdigest_get_findings`, `devdigest_get_conventions`, `devdigest_get_blast_radius`) as thin wrappers over existing `AgentsService`/`ReviewService`/`ConventionsService`, per onion-architecture (no `container.xxxRepo` access, only `new XService(container)`). Verified via `tsc --noEmit` (0 errors) and a throwaway `tsx` smoke script exercising real DB calls against the seeded Postgres instance — confirmed `resolveContext`, `resolveRepo` (including its not-found error text), `AgentsService.list`, `ConventionsService.list`, and `ReviewService.findingsForRun`'s `NotFoundError` path all work at runtime, not just typecheck. Files: mcp/src/tools/list-agents.ts, mcp/src/tools/get-findings.ts, mcp/src/tools/get-conventions.ts, mcp/src/tools/get-blast-radius.ts.

## Open Questions
