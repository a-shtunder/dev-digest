import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { Container } from '@server/platform/container.js';
import { AgentsService } from '@server/modules/agents/service.js';
import { resolveContext } from '../context.js';

/**
 * Discovery tool — surfaces configured reviewer agents so callers can pick a
 * valid `agent` id for `devdigest_run_agent_on_pr` instead of guessing one.
 * Deliberately drops `system_prompt`/`output_schema`/`version`/`ci_fail_on`/
 * `repo_intel`/`skill_count` from the response — token economy, this is a
 * discovery tool, not a config dump.
 */
export function registerListAgents(server: McpServer, container: Container): void {
  server.registerTool(
    'devdigest_list_agents',
    {
      description:
        'Call first to discover which reviewer agents are configured (id, name, provider, model). Use a returned id as `agent` in devdigest_run_agent_on_pr — do not guess an id.',
      inputSchema: {},
      annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
    },
    async () => {
      const { workspaceId } = await resolveContext(container);
      const agents = await new AgentsService(container).list(workspaceId);
      const trimmed = agents.map((a) => ({
        id: a.id,
        name: a.name,
        description: a.description,
        provider: a.provider,
        model: a.model,
        enabled: a.enabled,
        strategy: a.strategy,
      }));
      return { content: [{ type: 'text', text: JSON.stringify(trimmed) }] };
    },
  );
}
