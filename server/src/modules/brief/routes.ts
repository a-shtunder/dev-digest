import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { PrBriefResponse } from '@devdigest/shared';
import { getContext } from '../_shared/context.js';
import { IdParams } from '../_shared/schemas.js';

/**
 * brief module routes.
 *
 * GET  /pulls/:id/brief  → cache-only read (AC-9/AC-12): never generates,
 *   never calls the LLM. Returns the cached `PrBriefResponse` on a hit, or
 *   the empty-state marker `{ generated: false, brief: null }` on a miss
 *   (no stored row, or stale head_sha).
 * POST /pulls/:id/brief  → always (re)generates via `service.generate`.
 *   Rate-limited like intent/reviews: each call can fan out to two LLM calls.
 *
 * Onion layer: presentation — thin handlers: getContext → one service call →
 * reply. No business logic here.
 */
const BriefEmptyState = z.object({
  generated: z.literal(false),
  brief: z.null(),
});

const BriefGetResponse = z.union([PrBriefResponse, BriefEmptyState]);

// `.nullish()` on the whole body (not just its field) tolerates POSTs with no
// body at all (e.g. `fetch` with no `body` option, or `Content-Length: 0`) —
// Fastify's default JSON parser resolves a body-less POST's `req.body` to
// `null` (not `undefined`), which fails a bare z.object({...}); `.nullish()`
// accepts `undefined`, `null`, or a matching object.
const GenerateBriefBody = z
  .object({
    regenerate: z.boolean().optional(),
  })
  .nullish();

export default async function briefRoutes(appBase: FastifyInstance) {
  const app = appBase.withTypeProvider<ZodTypeProvider>();

  // ---- GET: cache-only read — never generates (AC-12) ----------------------
  app.get(
    '/pulls/:id/brief',
    { schema: { params: IdParams, response: { 200: BriefGetResponse } } },
    async (req) => {
      const { workspaceId } = await getContext(app.container, req);
      const cached = await app.container.briefService.getCached(workspaceId, req.params.id);
      return cached ?? { generated: false as const, brief: null };
    },
  );

  // ---- POST: always (re)generate ------------------------------------------
  // Rate-limited like intent/reviews: each call fans out to LLM calls.
  app.post(
    '/pulls/:id/brief',
    {
      schema: { params: IdParams, body: GenerateBriefBody, response: { 200: PrBriefResponse } },
      config: { rateLimit: { max: 10, timeWindow: '1 minute' } },
    },
    async (req) => {
      const { workspaceId } = await getContext(app.container, req);
      return app.container.briefService.generate(workspaceId, req.params.id, {
        regenerate: req.body?.regenerate,
      });
    },
  );
}
