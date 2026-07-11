import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { getContext } from '../_shared/context.js';
import { IdParams } from '../_shared/schemas.js';
import { BlastService } from './service.js';
import { BlastRadiusResult } from '@devdigest/shared';

/**
 * GET /pulls/:id/blast-radius — pure read over repoIntel.getBlastRadius.
 * No LLM call, no DB write; the data is already indexed at clone time.
 *
 * Declares the `response` schema (same pattern as smart-diff/routes.ts) so
 * the HTTP boundary is actually Zod-validated, not just TS-annotated.
 */
export default async function blastRoutes(appBase: FastifyInstance) {
  const app = appBase.withTypeProvider<ZodTypeProvider>();

  app.get(
    '/pulls/:id/blast-radius',
    { schema: { params: IdParams, response: { 200: BlastRadiusResult } } },
    async (req) => {
      const { workspaceId } = await getContext(app.container, req);
      const service = new BlastService(app.container);
      return service.getForPr(workspaceId, req.params.id);
    },
  );
}
