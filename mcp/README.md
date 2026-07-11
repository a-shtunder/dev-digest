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

Deliberately **not** committed as a project-scope `.mcp.json` at the repo
root — that would auto-load this server (and prompt for approval) in every
Claude Code session for every person who checks out the repo, and would run
even when nobody needs the tools. Instead, raise it explicitly, only when
you want it:

**Option A — register with Claude Code, local scope** (the default scope —
persists across your own sessions in this repo, stored in `~/.claude.json`,
never shared via git, nobody else gets it):

```sh
claude mcp add devdigest -- sh -c "cd mcp && tsx src/server.ts"
```

Run from the repo root (`local` is the default scope, no flag needed). The
`claude mcp add` CLI form has no `--cwd` flag, and **`tsx` resolves
`tsconfig.json` — and therefore this package's path aliases into
`server/src` — relative to the process's working directory, not the entry
file's location** (verified empirically: `tsx mcp/src/server.ts` run from
the repo root fails with `ERR_MODULE_NOT_FOUND` on `@server/*`; the `cd mcp
&&` wrapper above is required, not optional). Remove the registration with:

```sh
claude mcp remove devdigest
```

**Option B — one-off, for a single Claude Code invocation only** (the JSON
form DOES support a `cwd` field per server, unlike the `claude mcp add` CLI):

```sh
claude --mcp-config '{"mcpServers":{"devdigest":{"command":"tsx","args":["src/server.ts"],"cwd":"mcp"}}}'
```

**Option C — no Claude Code at all, raw process** (for manual testing, the
MCP Inspector, or a custom client — this one you always run with `mcp/` as
cwd already, so it just works):

```sh
cd mcp && pnpm start
```

If you do want project-scope sharing (everyone who opens the repo gets it
offered), that's a deliberate opt-in — create `.mcp.json` at the repo root
yourself with the same `cwd`-bearing JSON as Option B's `--mcp-config` value.

## Typecheck

```sh
cd mcp && pnpm typecheck
```

This also typechecks the reused `server/src/**` sources under this package's
own path aliases (`@devdigest/shared`, `@devdigest/reviewer-core`, `@server/*`)
— the primary integration risk for this package, since it's not a workspace
and cross-package imports rely entirely on `tsconfig.json` `paths` resolving
correctly at both `tsc` and `tsx` runtime.
