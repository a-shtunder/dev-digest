import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { Container } from '@server/platform/container.js';
import { ConventionsService } from '@server/modules/conventions/service.js';
import { resolveContext, resolveRepo } from '../context.js';

/**
 * List extracted coding conventions for a repo (house style/rules) — meant
 * to be called before reviewing, not as a substitute for reviewing a
 * specific PR. Paginated for large sets.
 */
export function registerGetConventions(server: McpServer, container: Container): void {
  server.registerTool(
    'devdigest_get_conventions',
    {
      description:
        'List extracted coding conventions (repo) for house style/rules — call before reviewing, not as a substitute for reviewing a specific PR; paginated for large sets.',
      inputSchema: {
        repo: z.string().describe('owner/name'),
        limit: z.number().int().positive().optional().describe('page size, default 20'),
        offset: z.number().int().nonnegative().optional().describe('pagination offset, default 0'),
      },
      annotations: { readOnlyHint: true, idempotentHint: true },
    },
    async ({ repo, limit, offset }) => {
      const { workspaceId } = await resolveContext(container);
      const repoRow = await resolveRepo(container, workspaceId, repo);

      const conventions = await new ConventionsService(container).list(workspaceId, repoRow.id);

      const start = offset ?? 0;
      const end = start + (limit ?? 20);
      const page = conventions.slice(start, end);

      const payload = { repo, total: conventions.length, conventions: page };
      return { content: [{ type: 'text', text: JSON.stringify(payload) }] };
    },
  );
}
