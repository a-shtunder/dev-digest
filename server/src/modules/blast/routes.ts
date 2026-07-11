import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { getContext } from '../_shared/context.js';
import { IdParams } from '../_shared/schemas.js';
import { BlastService } from './service.js';
import type { BlastRadiusResult } from '@devdigest/shared';

/**
 * GET /pulls/:id/blast-radius — pure read over repoIntel.getBlastRadius.
 * No LLM call, no DB write; the data is already indexed at clone time.
 *
 * No explicit Zod `response` schema — matches intent/repo-intel routes'
 * existing convention of relying on the TS return-type annotation only.
 */
export default async function blastRoutes(appBase: FastifyInstance) {
  const app = appBase.withTypeProvider<ZodTypeProvider>();

  app.get(
    '/pulls/:id/blast-radius',
    { schema: { params: IdParams } },
    async (req): Promise<BlastRadiusResult> => {
      const { workspaceId } = await getContext(app.container, req);
      const service = new BlastService(app.container);
      return service.getForPr(workspaceId, req.params.id);
    },
  );
}
