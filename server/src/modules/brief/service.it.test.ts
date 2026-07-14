import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { startPg, dockerAvailable, type PgFixture } from '../../../test/helpers/pg.js';
import { buildApp } from '../../app.js';
import { loadConfig } from '../../platform/config.js';
import { seed } from '../../db/seed.js';
import { MockLLMProvider, MockEmbedder, MockGitClient } from '../../adapters/mocks.js';
import * as t from '../../db/schema.js';
import { eq } from 'drizzle-orm';
import type { Brief } from '@devdigest/shared';

/**
 * T9 — brief endpoint integration tests (real Postgres via testcontainers).
 *
 * Only one PR file is seeded (`src/billing/handler.ts`) so the "changed files" set is
 * exactly `{ 'src/billing/handler.ts' }`. Every fixture below deliberately includes a
 * hallucinated ref pointing at a file NOT in that set to exercise the
 * drop+log path (AC-7/AC-8) end to end.
 */

const hasDocker = await dockerAvailable();
const d = hasDocker ? describe : describe.skip;

const config = () => loadConfig({ ...process.env, NODE_ENV: 'test' } as NodeJS.ProcessEnv);

const DIFF = `diff --git a/src/billing/handler.ts b/src/billing/handler.ts
--- a/src/billing/handler.ts
+++ b/src/billing/handler.ts
@@ -10,3 +10,4 @@
   port: 3000,
+  stripeKey: "sk_live_xxx",
   redisUrl: x,`;

/**
 * Brief fixture: one risk with a mix of a valid ref + a hallucinated ref
 * (risk survives, hallucinated ref dropped), one risk with ONLY invalid refs
 * (risk dropped entirely per AC-7), one valid review_focus item, and one
 * hallucinated review_focus item (dropped).
 */
const BRIEF_FIXTURE: Brief = {
  what: 'Adds a hardcoded Stripe key to the app config.',
  why: 'Needed to wire up billing quickly.',
  risk_level: 'high',
  risks: [
    {
      kind: 'security',
      title: 'Hardcoded secret',
      explanation: 'A live Stripe key is committed in source.',
      severity: 'high',
      file_refs: ['src/billing/handler.ts:11', 'src/ghost-file.ts:5'],
    },
    {
      kind: 'style',
      title: 'Phantom-only risk',
      explanation: 'Every ref on this risk points outside the PR.',
      severity: 'low',
      file_refs: ['src/nope.ts:1'],
    },
  ],
  review_focus: [
    { label: 'Check the secret', file_ref: 'src/billing/handler.ts:11', reason: 'Live key in diff.' },
    { label: 'Phantom focus', file_ref: 'src/nowhere.ts:3', reason: 'Not in this PR.' },
  ],
};

/** LLM-mock-facing shape: `{ files: [{path, summary}] }` — see classifier.ts's
 *  doc comment on why this isn't a `z.record(...)` or a bare top-level array
 *  (strict structured outputs forbid dynamic keys and require an object
 *  root). */
const CORE_SUMMARIES_LLM_FIXTURE = {
  files: [{ path: 'src/billing/handler.ts', summary: 'Adds a stripeKey field to the config object.' }],
};
/** Wire-response shape (`PrBriefResponse.core_summaries`): the service folds
 *  `files` above into this Record<path, summary> before returning it. */
const CORE_SUMMARIES_EXPECTED = { 'src/billing/handler.ts': 'Adds a stripeKey field to the config object.' };

/** A CoreFileSummariesList fixture that fails its own Zod schema (`files` isn't an array). */
const INVALID_CORE_SUMMARIES_FIXTURE = { files: { 'src/billing/handler.ts': 42 } };

/** A Brief fixture missing required fields — fails the `Brief` schema entirely. */
const INVALID_BRIEF_FIXTURE = { what: 'incomplete' };

let repoSeq = 0;
async function setupRepoAndPr(db: PgFixture['handle']['db'], workspaceId: string) {
  const name = `payments-api-${repoSeq++}`;
  const [repo] = await db
    .insert(t.repos)
    .values({ workspaceId, owner: 'acme', name, fullName: `acme/${name}` })
    .returning();
  const [pr] = await db
    .insert(t.pullRequests)
    .values({
      workspaceId,
      repoId: repo!.id,
      number: 900 + repoSeq,
      title: 'Add billing config',
      author: 'marisa.koch',
      branch: 'feat/billing',
      base: 'main',
      headSha: 'a1b2c3d4',
      additions: 1,
      deletions: 0,
      filesCount: 1,
      status: 'needs_review',
      body: 'Add billing config.',
    })
    .returning();
  await db.insert(t.prFiles).values({
    prId: pr!.id,
    path: 'src/billing/handler.ts',
    additions: 1,
    deletions: 0,
    patch: '@@ -10,3 +10,4 @@\n   port: 3000,\n+  stripeKey: "sk_live_xxx",\n   redisUrl: x,',
  });
  // Pre-seed pr_intent so IntentService.getOrCompute short-circuits without
  // its own LLM call (review_intent defaults to a different provider than
  // the one mocked here) — keeps the brief provider-call count exact.
  await db.insert(t.prIntent).values({
    prId: pr!.id,
    intent: 'Add billing support',
    inScope: ['src/billing/handler.ts'],
    outOfScope: [],
  });
  return { repo: repo!, pr: pr! };
}

d('brief endpoint (Testcontainers pg)', () => {
  let pg: PgFixture;
  let workspaceId: string;

  beforeAll(async () => {
    pg = await startPg();
    await seed(pg.handle.db);
    const [ws] = await pg.handle.db.select().from(t.workspaces);
    workspaceId = ws!.id;
  });
  afterAll(async () => {
    await pg?.stop();
  });

  async function appWith(
    structuredBySchema: Record<string, unknown>,
    llm = new MockLLMProvider('openai', { structuredBySchema }),
  ) {
    const app = await buildApp({
      config: config(),
      db: pg.handle.db,
      overrides: {
        embedder: new MockEmbedder(),
        git: new MockGitClient({ diff: DIFF }),
        llm: { openai: llm },
      },
    });
    return { app, llm };
  }

  it('miss: generates via ≤2 provider calls, drops hallucinated refs, keeps a full 5-field brief', async () => {
    const { app, llm } = await appWith({ Brief: BRIEF_FIXTURE, CoreFileSummariesList: CORE_SUMMARIES_LLM_FIXTURE });
    const { pr } = await setupRepoAndPr(pg.handle.db, workspaceId);

    const miss = await (await app.inject({ method: 'GET', url: `/pulls/${pr.id}/brief` })).json();
    expect(miss).toEqual({ generated: false, brief: null });

    const res = await app.inject({ method: 'POST', url: `/pulls/${pr.id}/brief`, payload: {} });
    expect(res.statusCode).toBe(200);
    const body = res.json();

    expect(body.generated).toBe(true);
    expect(body.head_sha).toBe('a1b2c3d4');
    // 5 fields present on the brief.
    expect(Object.keys(body.brief).sort()).toEqual(
      ['review_focus', 'risk_level', 'risks', 'what', 'why'].sort(),
    );
    // hallucinated ref dropped from the surviving risk, phantom-only risk dropped entirely.
    expect(body.brief.risks).toHaveLength(1);
    expect(body.brief.risks[0].file_refs).toEqual(['src/billing/handler.ts:11']);
    // hallucinated review_focus item dropped.
    expect(body.brief.review_focus).toHaveLength(1);
    expect(body.brief.review_focus[0].file_ref).toBe('src/billing/handler.ts:11');
    expect(body.core_summaries).toEqual(CORE_SUMMARIES_EXPECTED);

    // ≤2 provider calls: one for Brief, one for CoreFileSummariesList.
    const structuredCalls = llm.calls.filter((c) => c.method === 'completeStructured');
    expect(structuredCalls.length).toBeLessThanOrEqual(2);

    await app.close();
  });

  it('hit: GET returns the cached brief with zero provider calls', async () => {
    const { app, llm } = await appWith({ Brief: BRIEF_FIXTURE, CoreFileSummariesList: CORE_SUMMARIES_LLM_FIXTURE });
    const { pr } = await setupRepoAndPr(pg.handle.db, workspaceId);

    const generated = (
      await app.inject({ method: 'POST', url: `/pulls/${pr.id}/brief`, payload: {} })
    ).json();
    llm.calls.length = 0; // reset call log after the miss/generate path

    const hit = await (await app.inject({ method: 'GET', url: `/pulls/${pr.id}/brief` })).json();
    expect(hit.generated).toBe(false);
    expect(hit.head_sha).toBe(generated.head_sha);
    expect(hit.brief).toEqual(generated.brief);
    expect(hit.core_summaries).toEqual(generated.core_summaries);

    expect(llm.calls.filter((c) => c.method === 'completeStructured')).toHaveLength(0);

    await app.close();
  });

  it('new head SHA invalidates the cache: GET reports a miss again', async () => {
    const { app } = await appWith({ Brief: BRIEF_FIXTURE, CoreFileSummariesList: CORE_SUMMARIES_LLM_FIXTURE });
    const { pr } = await setupRepoAndPr(pg.handle.db, workspaceId);

    await app.inject({ method: 'POST', url: `/pulls/${pr.id}/brief`, payload: {} });
    const cachedHit = await (await app.inject({ method: 'GET', url: `/pulls/${pr.id}/brief` })).json();
    expect(cachedHit.generated).toBe(false);

    // Simulate a new push: PR's head_sha advances past the cached value.
    await pg.handle.db
      .update(t.pullRequests)
      .set({ headSha: 'newsha1234' })
      .where(eq(t.pullRequests.id, pr.id));

    const staleMiss = await (await app.inject({ method: 'GET', url: `/pulls/${pr.id}/brief` })).json();
    expect(staleMiss).toEqual({ generated: false, brief: null });

    await app.close();
  });

  it('Regenerate forces a rebuild and replaces the cache', async () => {
    const { app, llm } = await appWith({ Brief: BRIEF_FIXTURE, CoreFileSummariesList: CORE_SUMMARIES_LLM_FIXTURE });
    const { pr } = await setupRepoAndPr(pg.handle.db, workspaceId);

    await app.inject({ method: 'POST', url: `/pulls/${pr.id}/brief`, payload: {} });
    const firstCallCount = llm.calls.filter((c) => c.method === 'completeStructured').length;
    expect(firstCallCount).toBeGreaterThan(0);

    // Regenerate: same head_sha, still cached, but POST always (re)computes.
    const second = await app.inject({
      method: 'POST',
      url: `/pulls/${pr.id}/brief`,
      payload: { regenerate: true },
    });
    expect(second.statusCode).toBe(200);
    const secondCallCount = llm.calls.filter((c) => c.method === 'completeStructured').length;
    // A brand new set of provider calls was made — cache was NOT just replayed.
    expect(secondCallCount).toBeGreaterThan(firstCallCount);

    // The replaced cache is what a subsequent GET now serves (zero further calls).
    llm.calls.length = 0;
    const afterRegen = await (await app.inject({ method: 'GET', url: `/pulls/${pr.id}/brief` })).json();
    expect(afterRegen.generated).toBe(false);
    expect(afterRegen.brief).toEqual(second.json().brief);
    expect(llm.calls.filter((c) => c.method === 'completeStructured')).toHaveLength(0);

    await app.close();
  });

  it('per-file (core-summary) failure: the Brief is intact, core_summaries is {} — no error surfaced', async () => {
    const { app } = await appWith({
      Brief: BRIEF_FIXTURE,
      CoreFileSummariesList: INVALID_CORE_SUMMARIES_FIXTURE,
    });
    const { pr } = await setupRepoAndPr(pg.handle.db, workspaceId);

    const res = await app.inject({ method: 'POST', url: `/pulls/${pr.id}/brief`, payload: {} });
    expect(res.statusCode).toBe(200);
    const body = res.json();

    // Brief itself survives fully (all 5 fields, hallucination drop still applied).
    expect(body.brief.risks).toHaveLength(1);
    expect(body.brief.review_focus).toHaveLength(1);
    // Fail-soft: core_summaries degrades to {} with no hint of failure in the response.
    expect(body.core_summaries).toEqual({});

    await app.close();
  });

  it('Brief classification failure: returns an error and writes no cache (AC-18)', async () => {
    const { app } = await appWith({ Brief: INVALID_BRIEF_FIXTURE });
    const { pr } = await setupRepoAndPr(pg.handle.db, workspaceId);

    const res = await app.inject({ method: 'POST', url: `/pulls/${pr.id}/brief`, payload: {} });
    expect(res.statusCode).toBeGreaterThanOrEqual(500);

    const afterFailure = await (
      await app.inject({ method: 'GET', url: `/pulls/${pr.id}/brief` })
    ).json();
    expect(afterFailure).toEqual({ generated: false, brief: null });

    const [row] = await pg.handle.db.select().from(t.prBrief).where(eq(t.prBrief.prId, pr.id));
    expect(row).toBeUndefined();

    await app.close();
  });
});
