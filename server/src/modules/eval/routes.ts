import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import {
  EvalCaseInput,
  EvalCase,
  EvalRun,
  EvalRunResult,
  EvalRunRecord,
  EvalDashboard,
  EvalOverview,
} from '@devdigest/shared';
import { getContext } from '../_shared/context.js';
import { IdParams } from '../_shared/schemas.js';

/**
 * eval module (L06 T5).
 *   POST /findings/:id/eval-case      one-click create from a finding's accept/dismiss decision
 *   POST /agents/:id/eval-cases       generic create
 *   PATCH /eval-cases/:id             update an existing case in place
 *   DELETE /eval-cases/:id            delete a case (its run history cascades)
 *   GET  /agents/:id/eval-cases       list this agent's cases
 *   POST /agents/:id/eval-runs        batch run (rate-limited — mirrors reviews/routes.ts)
 *   POST /eval-cases/:id/run          single-case run
 *   GET  /eval-cases/:id/runs         run history for one case
 *   GET  /agents/:id/eval-dashboard   per-agent dashboard
 *   GET  /eval/dashboard              workspace overview
 *
 * `owner_kind`/`owner_id` on the generic-create body are resolved by the route
 * (from `:id`), never trusted from the caller — mirrors `EvalCaseInput`'s own
 * doc comment ("id + owner resolved by the route").
 */
const CreateEvalCaseBody = EvalCaseInput.omit({ owner_kind: true, owner_id: true });

export default async function evalRoutes(appBase: FastifyInstance) {
  const app = appBase.withTypeProvider<ZodTypeProvider>();

  // NOTE: `app.container.evalService` is resolved INSIDE each handler (never
  // hoisted to plugin-registration time) — mirrors `brief/routes.ts`. Plugin
  // *registration* must not touch `app.container` so a bare `Fastify()` (no
  // container decorated) can still register this plugin to inspect route
  // config, e.g. the rate-limit assertion in `routes.test.ts`.

  // ---- One-click create from a finding -------------------------------------
  app.post(
    '/findings/:id/eval-case',
    { schema: { params: IdParams, response: { 200: EvalCase } } },
    async (req) => {
      const { workspaceId } = await getContext(app.container, req);
      return app.container.evalService.createFromFinding(workspaceId, req.params.id);
    },
  );

  // ---- Generic create + list for an agent ----------------------------------
  app.post(
    '/agents/:id/eval-cases',
    { schema: { params: IdParams, body: CreateEvalCaseBody, response: { 200: EvalCase } } },
    async (req) => {
      const { workspaceId } = await getContext(app.container, req);
      return app.container.evalService.createCase(workspaceId, {
        ...req.body,
        owner_kind: 'agent',
        owner_id: req.params.id,
      });
    },
  );

  // ---- Update an existing case in place ------------------------------------
  app.patch(
    '/eval-cases/:id',
    { schema: { params: IdParams, body: CreateEvalCaseBody, response: { 200: EvalCase } } },
    async (req) => {
      const { workspaceId } = await getContext(app.container, req);
      const existing = await app.container.evalService.getCase(workspaceId, req.params.id);
      return app.container.evalService.updateCase(workspaceId, req.params.id, {
        ...req.body,
        owner_kind: existing.owner_kind,
        owner_id: existing.owner_id,
      });
    },
  );

  // ---- Delete a case (its eval_runs history cascades via FK) --------------
  app.delete('/eval-cases/:id', { schema: { params: IdParams } }, async (req) => {
    const { workspaceId } = await getContext(app.container, req);
    await app.container.evalService.deleteCase(workspaceId, req.params.id);
    return { ok: true };
  });

  app.get(
    '/agents/:id/eval-cases',
    { schema: { params: IdParams, response: { 200: z.array(EvalCase) } } },
    async (req) => {
      const { workspaceId } = await getContext(app.container, req);
      return app.container.evalService.listCasesForAgent(workspaceId, req.params.id);
    },
  );

  // ---- Batch run (rate-limited, mirrors reviews/routes.ts:29) -------------
  app.post(
    '/agents/:id/eval-runs',
    {
      schema: { params: IdParams, response: { 200: EvalRun } },
      config: { rateLimit: { max: 10, timeWindow: '1 minute' } },
    },
    async (req) => {
      const { workspaceId } = await getContext(app.container, req);
      return app.container.evalService.runSet(workspaceId, req.params.id);
    },
  );

  // ---- Single-case run (rate-limited, mirrors batch run above) --------------
  app.post(
    '/eval-cases/:id/run',
    {
      schema: { params: IdParams, response: { 200: EvalRunResult } },
      config: { rateLimit: { max: 10, timeWindow: '1 minute' } },
    },
    async (req) => {
      const { workspaceId } = await getContext(app.container, req);
      return app.container.evalService.runCase(workspaceId, req.params.id);
    },
  );

  // ---- Run history for a case ------------------------------------------------
  app.get(
    '/eval-cases/:id/runs',
    { schema: { params: IdParams, response: { 200: z.array(EvalRunRecord) } } },
    async (req) => {
      const { workspaceId } = await getContext(app.container, req);
      return app.container.evalService.runHistory(workspaceId, req.params.id);
    },
  );

  // ---- Dashboards -------------------------------------------------------------
  app.get(
    '/agents/:id/eval-dashboard',
    { schema: { params: IdParams, response: { 200: EvalDashboard } } },
    async (req) => {
      const { workspaceId } = await getContext(app.container, req);
      return app.container.evalService.dashboard(workspaceId, req.params.id);
    },
  );

  app.get(
    '/eval/dashboard',
    { schema: { response: { 200: EvalOverview } } },
    async (req) => {
      const { workspaceId } = await getContext(app.container, req);
      return app.container.evalService.overview(workspaceId);
    },
  );
}
