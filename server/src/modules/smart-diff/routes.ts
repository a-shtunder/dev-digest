import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { SmartDiffResponse } from '@devdigest/shared';
import { getContext } from '../_shared/context.js';
import { IdParams } from '../_shared/schemas.js';
import { SmartDiffService } from './service.js';

/**
 * smart-diff module routes.
 *
 * GET /pulls/:id/smart-diff → deterministic recomposition of PR files +
 * last review's findings + per-file summaries. No POST/recompute — this is
 * always computed fresh from already-stored data, zero LLM calls.
 *
 * Onion layer: presentation — thin handler: getContext → one service call → reply.
 */
export default async function smartDiffRoutes(appBase: FastifyInstance) {
  const app = appBase.withTypeProvider<ZodTypeProvider>();

  app.get(
    '/pulls/:id/smart-diff',
    { schema: { params: IdParams, response: { 200: SmartDiffResponse } } },
    async (req) => {
      const { workspaceId } = await getContext(app.container, req);
      return new SmartDiffService(app.container).getForPull(workspaceId, req.params.id);
    },
  );
}
