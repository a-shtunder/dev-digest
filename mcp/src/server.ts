import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { getContainer, closeContainer } from './bootstrap.js';
import { registerListAgents } from './tools/list-agents.js';
import { registerRunAgentOnPr } from './tools/run-agent-on-pr.js';
import { registerGetFindings } from './tools/get-findings.js';
import { registerGetConventions } from './tools/get-conventions.js';
import { registerGetBlastRadius } from './tools/get-blast-radius.js';

/**
 * DevDigest local MCP server — stdio transport. 5 tools over the existing
 * review/agents/conventions services (no duplicated business logic; each
 * tool is a thin wrapper, same role Fastify routes play for the HTTP API).
 *
 * Never write to stdout outside the SDK — it owns the transport's stdio
 * stream. All diagnostics go to stderr via console.error.
 */
async function main() {
  const container = getContainer();

  const server = new McpServer(
    { name: 'devdigest-mcp', version: '0.1.0' },
    {
      instructions:
        'Tool names are namespaced devdigest_*. Args use human ids, not internal UUIDs: ' +
        'repo is "owner/name", pr is the GitHub PR number. agent is either a UUID returned ' +
        'by devdigest_list_agents, or the literal string "all" (every enabled agent) — do ' +
        'not guess an id. Workspace is auto-resolved (single local workspace, no auth in ' +
        'this MVP). devdigest_run_agent_on_pr already waits and returns findings — call ' +
        'devdigest_get_findings only to re-check a run from an earlier session, not right ' +
        'after devdigest_run_agent_on_pr. Findings are addressed by file:line, not by ' +
        'internal UUID.',
    },
  );

  registerListAgents(server, container);
  registerRunAgentOnPr(server, container);
  registerGetFindings(server, container);
  registerGetConventions(server, container);
  registerGetBlastRadius(server, container);

  let closing = false;
  for (const signal of ['SIGTERM', 'SIGINT'] as const) {
    process.once(signal, async () => {
      if (closing) return;
      closing = true;
      try {
        await closeContainer();
        process.exit(0);
      } catch (err) {
        console.error(err);
        process.exit(1);
      }
    });
  }

  await server.connect(new StdioServerTransport());
  console.error('devdigest-mcp listening on stdio');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
