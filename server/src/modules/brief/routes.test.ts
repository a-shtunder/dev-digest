import { describe, it, expect, afterEach } from 'vitest';
import Fastify from 'fastify';
import { validatorCompiler, serializerCompiler } from 'fastify-type-provider-zod';
import { buildApp } from '../../app.js';
import { loadConfig } from '../../platform/config.js';
import { MockAuthProvider } from '../../adapters/mocks.js';
import * as t from '../../db/schema.js';
import briefRoutes from './routes.js';
import type { FastifyInstance } from 'fastify';

/**
 * Hermetic route test for the `brief` module (T7). Uses a fake `Db` so no
 * Postgres/testcontainers is needed — only `db.select().from(table).where()`
 * is exercised by `getCached` (getPull + BriefRepository.get), which is all
 * the GET no-cache path touches.
 */
const config = loadConfig({ ...process.env, NODE_ENV: 'test' } as NodeJS.ProcessEnv);

const PR_ID = '11111111-1111-1111-1111-111111111111';

/** Minimal fake Db: `select().from(table).where()` resolves per-table. */
function fakeDb(pullRow: Record<string, unknown> | undefined) {
  return {
    select: () => ({
      from: (table: unknown) => ({
        where: async () => {
          if (table === t.pullRequests) return pullRow ? [pullRow] : [];
          if (table === t.prBrief) return []; // no cached brief -> cache miss
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

describe('brief routes', () => {
  it('GET /pulls/:id/brief on a no-cache PR returns the empty-state marker, no provider call', async () => {
    const pullRow = { id: PR_ID, workspaceId: 'w1', headSha: 'abc123' };
    app = await buildApp({
      config,
      db: fakeDb(pullRow),
      overrides: { auth: new MockAuthProvider() },
    });

    const res = await app.inject({ method: 'GET', url: `/pulls/${PR_ID}/brief` });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ generated: false, brief: null });
  });

  it('POST /pulls/:id/brief is registered with the 10/min rate-limit config', async () => {
    // Register the plugin directly on a bare Fastify instance and capture
    // route config via `onRoute` — avoids needing a real DB/container since
    // registration never touches `app.container` (only route handlers do).
    const bare = Fastify();
    bare.setValidatorCompiler(validatorCompiler);
    bare.setSerializerCompiler(serializerCompiler);

    const captured: { method: string; url: string; config?: unknown }[] = [];
    bare.addHook('onRoute', (opts) => {
      captured.push({ method: String(opts.method), url: opts.url, config: opts.config });
    });

    await bare.register(briefRoutes);
    await bare.ready();

    const postRoute = captured.find((r) => r.method === 'POST' && r.url === '/pulls/:id/brief');
    expect(postRoute?.config).toMatchObject({ rateLimit: { max: 10, timeWindow: '1 minute' } });

    await bare.close();
  });
});
