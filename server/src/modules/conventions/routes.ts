import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { getContext } from '../_shared/context.js';
import { IdParams } from '../_shared/schemas.js';
import { NotFoundError } from '../../platform/errors.js';
import { ConventionsService } from './service.js';

const UpdateConventionBody = z.object({ rule: z.string().min(1) });

/**
 * L02 — conventions module. Transport layer only; delegates to ConventionsService.
 *   POST /repos/:id/conventions/extract → run extraction (sample → model → verify → persist)
 *   GET  /repos/:id/conventions         → list persisted candidates (workspace-scoped)
 *   POST /conventions/:id/accept        → mark accepted
 *   POST /conventions/:id/reject        → mark rejected
 */
export default async function conventionsRoutes(appBase: FastifyInstance) {
  const app = appBase.withTypeProvider<ZodTypeProvider>();
  const service = new ConventionsService(app.container);

  // Extraction makes a model call — rate-limit it like reviews.
  app.post(
    '/repos/:id/conventions/extract',
    {
      schema: { params: IdParams },
      config: { rateLimit: { max: 10, timeWindow: '1 minute' } },
    },
    async (req) => {
      const { workspaceId } = await getContext(app.container, req);
      return service.extract(workspaceId, req.params.id);
    },
  );

  app.get('/repos/:id/conventions', { schema: { params: IdParams } }, async (req) => {
    const { workspaceId } = await getContext(app.container, req);
    return service.list(workspaceId, req.params.id);
  });

  app.post('/conventions/:id/accept', { schema: { params: IdParams } }, async (req) => {
    const { workspaceId } = await getContext(app.container, req);
    return service.setAccepted(workspaceId, req.params.id, true);
  });

  app.post('/conventions/:id/reject', { schema: { params: IdParams } }, async (req) => {
    const { workspaceId } = await getContext(app.container, req);
    return service.setAccepted(workspaceId, req.params.id, false);
  });

  app.patch(
    '/conventions/:id',
    { schema: { params: IdParams, body: UpdateConventionBody } },
    async (req) => {
      const { workspaceId } = await getContext(app.container, req);
      return service.updateRule(workspaceId, req.params.id, req.body.rule);
    },
  );

  app.delete('/conventions/:id', { schema: { params: IdParams } }, async (req) => {
    const { workspaceId } = await getContext(app.container, req);
    const ok = await service.remove(workspaceId, req.params.id);
    if (!ok) throw new NotFoundError('Convention not found');
    return { deleted: req.params.id };
  });
}
