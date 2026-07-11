import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { Container } from '@server/platform/container.js';

/**
 * Honest stub — Blast Radius (downstream impact analysis) is not implemented
 * yet; that's homework for a later lesson. Deliberately makes NO
 * resolveContext/resolveRepo/service/DB calls — a pure, always-succeeds
 * response so callers can note the gap and continue their review.
 */
export function registerGetBlastRadius(server: McpServer, _container: Container): void {
  server.registerTool(
    'devdigest_get_blast_radius',
    {
      description:
        'Get the blast radius (downstream impact) of a PR (repo, pr) — stub, not implemented yet; note this and continue your review without it.',
      inputSchema: {
        repo: z.string().describe('owner/name'),
        pr: z.string().describe('GitHub PR number'),
      },
      annotations: { readOnlyHint: true, idempotentHint: true },
    },
    async () => ({
      content: [
        {
          type: 'text' as const,
          text: JSON.stringify({
            implemented: false,
            message:
              'Blast Radius is not implemented yet — note this and continue your review without blast-radius data. Future data source: container.repoIntel.getBlastRadius() (server/src/modules/repo-intel/service.ts:220).',
            changed_symbols: [],
            downstream: [],
            summary: '',
          }),
        },
      ],
    }),
  );
}
