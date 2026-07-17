import { describe, it, expect, afterEach } from 'vitest';
import Fastify from 'fastify';
import { validatorCompiler, serializerCompiler } from 'fastify-type-provider-zod';
import { buildApp } from '../../app.js';
import { loadConfig } from '../../platform/config.js';
import { MockAuthProvider } from '../../adapters/mocks.js';
import * as t from '../../db/schema.js';
import evalRoutes from './routes.js';
import type { FastifyInstance } from 'fastify';

/**
 * Hermetic route tests for the `eval` module (T5). Mirrors
 * `brief/routes.test.ts`'s pattern: a bare `Fastify()` instance for the
 * rate-limit-config assertion (registration never touches `app.container`),
 * and a fake `Db` for the IDOR assertion (only the three sequential
 * `select().from(table).where()` calls behind `findingContext` are exercised
 * by `createFromFinding`'s workspace check, which runs before anything else).
 */
const config = loadConfig({ ...process.env, NODE_ENV: 'test' } as NodeJS.ProcessEnv);

const FINDING_ID = '11111111-1111-1111-1111-111111111111';
const REVIEW_ID = '22222222-2222-2222-2222-222222222222';
const PULL_ID = '33333333-3333-3333-3333-333333333333';

/** Fake Db: resolves the finding -> review -> pull chain `findingContext` walks,
 *  with the pull bound to a DIFFERENT workspace than the caller's ('w1'). */
function crossWorkspaceDb() {
  return {
    select: () => ({
      from: (table: unknown) => ({
        where: async () => {
          if (table === t.findings) {
            return [
              {
                id: FINDING_ID,
                reviewId: REVIEW_ID,
                file: 'a.ts',
                startLine: 1,
                endLine: 1,
                severity: 'WARNING',
                category: 'bug',
                title: 'Something',
                rationale: 'because',
                suggestion: null,
                confidence: 0.9,
                kind: 'finding',
                trifectaComponents: null,
                acceptedAt: new Date(),
                dismissedAt: null,
              },
            ];
          }
          if (table === t.reviews) {
            return [
              {
                id: REVIEW_ID,
                workspaceId: 'other-workspace',
                prId: PULL_ID,
                agentId: 'agent-1',
                runId: null,
                kind: 'review',
                verdict: null,
                summary: null,
                score: null,
                model: null,
              },
            ];
          }
          if (table === t.pullRequests) {
            return [{ id: PULL_ID, workspaceId: 'other-workspace' }];
          }
          return [];
        },
      }),
    }),
  } as unknown as import('../../db/client.js').Db;
}

let app: FastifyInstance | undefined;

afterEach(async () => {
  await app?.close();
  app = undefined;
});

describe('eval routes', () => {
  it('POST /agents/:id/eval-runs is registered with the 10/min rate-limit config', async () => {
    // Register the plugin directly on a bare Fastify instance and capture route
    // config via `onRoute` — avoids needing a real DB/container since plugin
    // *registration* never touches `app.container` (only route handlers do).
    const bare = Fastify();
    bare.setValidatorCompiler(validatorCompiler);
    bare.setSerializerCompiler(serializerCompiler);

    const captured: { method: string; url: string; config?: unknown }[] = [];
    bare.addHook('onRoute', (opts) => {
      captured.push({ method: String(opts.method), url: opts.url, config: opts.config });
    });

    await bare.register(evalRoutes);
    await bare.ready();

    const runsRoute = captured.find(
      (r) => r.method === 'POST' && r.url === '/agents/:id/eval-runs',
    );
    expect(runsRoute?.config).toMatchObject({ rateLimit: { max: 10, timeWindow: '1 minute' } });

    await bare.close();
  });

  it('POST /findings/:id/eval-case rejects a cross-workspace finding (IDOR)', async () => {
    app = await buildApp({
      config,
      db: crossWorkspaceDb(),
      overrides: { auth: new MockAuthProvider() }, // caller's workspace is 'w1'
    });

    const res = await app.inject({
      method: 'POST',
      url: `/findings/${FINDING_ID}/eval-case`,
    });

    expect(res.statusCode).toBe(404);
    expect(res.json()).toMatchObject({ error: { code: 'not_found' } });
  });
});
