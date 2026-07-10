# @devdigest/mcp

Local MCP server (stdio transport) exposing 5 tools over the existing DevDigest
review pipeline. No new business logic — every tool is a thin wrapper over the
same `AgentsService` / `ReviewService` / `ConventionsService` / `RepoService`
classes the REST API (`server/`) already uses.

## Prerequisites

- `server/node_modules` installed (`cd server && pnpm install`) — the heavy
  dependency graph (Drizzle, Octokit, OpenAI, etc.) resolves from there at
  runtime, since the source files this package imports live in `server/src`.
- `reviewer-core/node_modules` installed (`cd reviewer-core && npm install`)
  — `server/src/modules/reviews/run-executor.ts` imports `@devdigest/reviewer-core`.
- Postgres up and migrated/seeded (`./scripts/dev.sh --db-only` then
  `cd server && pnpm db:seed`).
- `cd mcp && pnpm install`.

The Fastify API (`server/`) does **not** need to be running — this package
boots its own `Container` directly against Postgres, no HTTP involved.

## Run

```sh
cd mcp && pnpm start   # tsx src/server.ts — connects over stdio
```

Typically you won't run this directly; an MCP client spawns it as a
subprocess (see `.mcp.json` at the repo root).

## Tools

All tool names are namespaced `devdigest_*`. Shared conventions (id formats,
workspace auto-resolution) are sent once via the server's `instructions`
field, not repeated per tool.

| Tool | Args | Notes |
|---|---|---|
| `devdigest_list_agents` | — | Discovery — returns a valid `agent` id for the tool below. |
| `devdigest_run_agent_on_pr` | `repo` (owner/name), `pr` (number), `agent` (id or `"all"`) | The only mutating tool. Blocks until the run(s) finish — no artificial timeout — then returns a concise per-run verdict. |
| `devdigest_get_findings` | `run_id`, `limit?`, `offset?` | Findings for an already-completed run, paginated. |
| `devdigest_get_conventions` | `repo`, `limit?`, `offset?` | Extracted repo conventions, paginated. |
| `devdigest_get_blast_radius` | `repo`, `pr` | Stub — not implemented yet (future lesson). |

## Registering with an MCP client

Add to `.mcp.json` at the repo root (already present):

```json
{
  "mcpServers": {
    "devdigest": {
      "command": "tsx",
      "args": ["src/server.ts"],
      "cwd": "mcp"
    }
  }
}
```

## Typecheck

```sh
cd mcp && pnpm typecheck
```

This also typechecks the reused `server/src/**` sources under this package's
own path aliases (`@devdigest/shared`, `@devdigest/reviewer-core`, `@server/*`)
— the primary integration risk for this package, since it's not a workspace
and cross-package imports rely entirely on `tsconfig.json` `paths` resolving
correctly at both `tsc` and `tsx` runtime.
