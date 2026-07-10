import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { Container } from '@server/platform/container.js';
import { ReviewService } from '@server/modules/reviews/service.js';
import { NotFoundError } from '@server/platform/errors.js';
import { resolveContext } from '../context.js';

/**
 * Get a previously completed run's verdict + paginated file:line findings.
 * `run_id` only comes from `devdigest_run_agent_on_pr` — an unknown id is
 * rewritten into an actionable error ("error leads forward" rule) rather
 * than surfacing the raw NotFoundError message.
 */
export function registerGetFindings(server: McpServer, container: Container): void {
  server.registerTool(
    'devdigest_get_findings',
    {
      description:
        'Get a concise verdict and file:line findings (run_id) for a previously completed run; paginated (limit/offset) for large result sets.',
      inputSchema: {
        run_id: z.string().describe('run id returned by devdigest_run_agent_on_pr'),
        limit: z.number().int().positive().optional().describe('page size, default 20'),
        offset: z.number().int().nonnegative().optional().describe('pagination offset, default 0'),
      },
      annotations: { readOnlyHint: true, idempotentHint: true },
    },
    async ({ run_id, limit, offset }) => {
      const { workspaceId } = await resolveContext(container);

      let result;
      try {
        result = await new ReviewService(container).findingsForRun(workspaceId, run_id);
      } catch (err) {
        if (err instanceof NotFoundError) {
          throw new Error(
            `Run '${run_id}' not found — not an internal id you should guess; run_id only comes from devdigest_run_agent_on_pr.`,
          );
        }
        throw err;
      }

      if (result.status !== 'done') {
        return { content: [{ type: 'text', text: JSON.stringify(result) }] };
      }

      const start = offset ?? 0;
      const end = start + (limit ?? 20);
      const findings = result.review.findings.slice(start, end);

      const payload = {
        run_id,
        status: 'done' as const,
        verdict: result.review.verdict,
        score: result.review.score,
        findings_total: result.review.findings.length,
        findings,
      };
      return { content: [{ type: 'text', text: JSON.stringify(payload) }] };
    },
  );
}
