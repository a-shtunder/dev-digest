import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { Container } from '@server/platform/container.js';
import { ReviewService } from '@server/modules/reviews/service.js';
import { resolveContext, resolveRepo } from '../context.js';

/**
 * Action tool — runs a reviewer agent on a PR and blocks until every target
 * run reaches a terminal state (done/failed/cancelled), then returns the
 * concise per-run summary `ReviewService.runReviewAndWait` already produces.
 * Deliberately does NOT include full findings detail in the response — that
 * keeps the payload small even when `agent: 'all'` fans out to many agents;
 * callers fetch findings separately via `devdigest_get_findings` using the
 * `run_id`s returned here.
 *
 * Input is flat (`repo`/`pr`/`agent` as separate strings, not a nested
 * object) — a deliberate design choice from the plan, since models make more
 * mistakes filling in nested tool args than flat ones.
 */
export function registerRunAgentOnPr(server: McpServer, container: Container): void {
  server.registerTool(
    'devdigest_run_agent_on_pr',
    {
      title: 'Run agent on PR',
      description:
        'Run a reviewer agent on a pull request (repo, pr, agent) and return the finished verdict with file:line findings — waits, does not just start a run. Use after devdigest_list_agents if you don’t already have a valid agent id.',
      inputSchema: {
        repo: z.string().describe('owner/name'),
        pr: z.string().describe('GitHub PR number'),
        agent: z.string().describe("agent id from devdigest_list_agents, or 'all'"),
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: true,
      },
    },
    async ({ repo, pr, agent }) => {
      const { workspaceId } = await resolveContext(container);
      const repoRow = await resolveRepo(container, workspaceId, repo);

      const service = new ReviewService(container);

      const pull = await service.findPrByNumber(workspaceId, repoRow.id, Number(pr));
      if (!pull) {
        throw new Error(`PR #${pr} not found in ${repo} — import/poll it in DevDigest first.`);
      }

      const targets = await service
        .resolveTargets(workspaceId, agent === 'all' ? { all: true } : { agentId: agent })
        .catch(() => {
          throw new Error(
            `Agent '${agent}' not found — do not guess an id, call devdigest_list_agents first.`,
          );
        });

      const runs = await service.runReviewAndWait(workspaceId, pull.id, targets);

      return { content: [{ type: 'text', text: JSON.stringify({ repo, pr, runs }) }] };
    },
  );
}
