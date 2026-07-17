import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { and, eq } from 'drizzle-orm';
import { startPg, dockerAvailable, type PgFixture } from '../../../test/helpers/pg.js';
import { buildApp } from '../../app.js';
import { loadConfig } from '../../platform/config.js';
import { seed } from '../../db/seed.js';
import { MockLLMProvider, MockGitClient } from '../../adapters/mocks.js';
import * as t from '../../db/schema.js';
import type { Review, StructuredRequest, StructuredResult } from '@devdigest/shared';

/**
 * T6 — eval module integration tests (real Postgres via testcontainers).
 *
 * `DIFF` touches a single file (`src/config.ts`) with one hunk covering
 * new-side lines 10-12, so a finding at `src/config.ts:11` grounds cleanly and
 * a finding on any other file/line is dropped by the citation gate.
 */

const hasDocker = await dockerAvailable();
const d = hasDocker ? describe : describe.skip;

const config = () => loadConfig({ ...process.env, NODE_ENV: 'test' } as NodeJS.ProcessEnv);

const DIFF = `diff --git a/src/config.ts b/src/config.ts
--- a/src/config.ts
+++ b/src/config.ts
@@ -10,3 +10,4 @@
   port: 3000,
+  stripeKey: "REDACTED_STRIPE_SECRET_DO_NOT_USE",
   redisUrl: x,`;

/** A Review fixture with one finding that grounds against DIFF (file+line match). */
const GROUNDED_REVIEW: Review = {
  verdict: 'comment',
  summary: 'Found a hardcoded secret.',
  score: 65,
  findings: [
    {
      id: 'f1',
      severity: 'CRITICAL',
      category: 'security',
      title: 'Hardcoded secret',
      file: 'src/config.ts',
      start_line: 11,
      end_line: 11,
      rationale: 'A live key is committed in source.',
      suggestion: null,
      confidence: 0.9,
      kind: 'finding',
    },
  ],
};

/** A Review fixture with zero findings — used for cases whose expectation is `[]`. */
const EMPTY_REVIEW: Review = {
  verdict: 'approve',
  summary: 'Looks fine.',
  score: 95,
  findings: [],
};

/** LLM that throws when the assembled prompt contains a marker string — used
 *  to simulate one case failing mid-batch (fail-soft, AC-19) without needing
 *  per-case LLM fixtures (reviewPullRequest always calls completeStructured
 *  with schemaName 'Review'). */
class FlakyLLMProvider extends MockLLMProvider {
  constructor(private failMarker: string, structured: unknown) {
    super('openai', { structured });
  }
  override async completeStructured<T>(req: StructuredRequest<T>): Promise<StructuredResult<T>> {
    const text = JSON.stringify(req.messages);
    if (text.includes(this.failMarker)) {
      throw new Error('simulated provider failure');
    }
    return super.completeStructured(req);
  }
}

let repoSeq = 0;

async function setupWorkspaceRepoPrAgent(db: PgFixture['handle']['db'], workspaceId: string) {
  const name = `eval-repo-${repoSeq++}`;
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
      title: 'Add config',
      author: 'marisa.koch',
      branch: 'feat/config',
      base: 'main',
      headSha: 'a1b2c3d4',
      additions: 1,
      deletions: 0,
      filesCount: 1,
      status: 'needs_review',
    })
    .returning();
  await db.insert(t.prFiles).values({
    prId: pr!.id,
    path: 'src/config.ts',
    additions: 1,
    deletions: 0,
    patch: '@@ -10,3 +10,4 @@\n   port: 3000,\n+  stripeKey: "REDACTED_STRIPE_SECRET_DO_NOT_USE",\n   redisUrl: x,',
  });
  const [agent] = await db
    .insert(t.agents)
    .values({
      workspaceId,
      name: `Eval Agent ${repoSeq}`,
      provider: 'openai',
      model: 'gpt-4.1',
      systemPrompt: 'You are a careful reviewer.',
    })
    .returning();
  return { repo: repo!, pr: pr!, agent: agent! };
}

async function createReviewAndFinding(
  db: PgFixture['handle']['db'],
  workspaceId: string,
  prId: string,
  agentId: string,
  decision: 'accepted' | 'dismissed' | 'none',
) {
  const [review] = await db
    .insert(t.reviews)
    .values({ workspaceId, prId, agentId, kind: 'review' })
    .returning();
  const [finding] = await db
    .insert(t.findings)
    .values({
      reviewId: review!.id,
      file: 'src/config.ts',
      startLine: 11,
      endLine: 11,
      severity: 'CRITICAL',
      category: 'security',
      title: 'Hardcoded secret',
      rationale: 'A live key is committed in source.',
      confidence: 0.9,
      acceptedAt: decision === 'accepted' ? new Date() : null,
      dismissedAt: decision === 'dismissed' ? new Date() : null,
    })
    .returning();
  return { review: review!, finding: finding! };
}

d('eval module (Testcontainers pg)', () => {
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

  async function appWith(llm: MockLLMProvider) {
    const app = await buildApp({
      config: config(),
      db: pg.handle.db,
      overrides: {
        git: new MockGitClient({ diff: DIFF }),
        llm: { openai: llm },
      },
    });
    return app;
  }

  it('one-click on an accepted finding creates a case with [skeleton] and a sliced input_diff', async () => {
    const llm = new MockLLMProvider('openai', { structured: EMPTY_REVIEW });
    const app = await appWith(llm);
    const { pr, agent } = await setupWorkspaceRepoPrAgent(pg.handle.db, workspaceId);
    const { finding } = await createReviewAndFinding(pg.handle.db, workspaceId, pr.id, agent.id, 'accepted');

    const res = await app.inject({ method: 'POST', url: `/findings/${finding.id}/eval-case` });
    expect(res.statusCode).toBe(200);
    const body = res.json();

    expect(body.owner_kind).toBe('agent');
    expect(body.owner_id).toBe(agent.id);
    expect(body.expected_output).toEqual([
      {
        severity: 'CRITICAL',
        category: 'security',
        title: 'Hardcoded secret',
        file: 'src/config.ts',
        start_line: 11,
        end_line: 11,
      },
    ]);
    expect(body.input_diff).toContain('src/config.ts');
    expect(body.input_diff).toContain('diff --git');

    await app.close();
  });

  it('one-click on a dismissed finding creates a case with expected_output []', async () => {
    const llm = new MockLLMProvider('openai', { structured: EMPTY_REVIEW });
    const app = await appWith(llm);
    const { pr, agent } = await setupWorkspaceRepoPrAgent(pg.handle.db, workspaceId);
    const { finding } = await createReviewAndFinding(pg.handle.db, workspaceId, pr.id, agent.id, 'dismissed');

    const res = await app.inject({ method: 'POST', url: `/findings/${finding.id}/eval-case` });
    expect(res.statusCode).toBe(200);
    expect(res.json().expected_output).toEqual([]);

    await app.close();
  });

  it('one-click on a no-decision finding rejects with an explicit error and creates no case', async () => {
    const llm = new MockLLMProvider('openai', { structured: EMPTY_REVIEW });
    const app = await appWith(llm);
    const { pr, agent } = await setupWorkspaceRepoPrAgent(pg.handle.db, workspaceId);
    const { finding } = await createReviewAndFinding(pg.handle.db, workspaceId, pr.id, agent.id, 'none');

    const before = await pg.handle.db
      .select()
      .from(t.evalCases)
      .where(and(eq(t.evalCases.workspaceId, workspaceId), eq(t.evalCases.ownerId, agent.id)));

    const res = await app.inject({ method: 'POST', url: `/findings/${finding.id}/eval-case` });
    expect(res.statusCode).toBeGreaterThanOrEqual(400);
    expect(res.statusCode).toBeLessThan(500);

    const after = await pg.handle.db
      .select()
      .from(t.evalCases)
      .where(and(eq(t.evalCases.workspaceId, workspaceId), eq(t.evalCases.ownerId, agent.id)));
    expect(after.length).toBe(before.length);

    await app.close();
  });

  it('one-click on a cross-workspace finding is rejected (IDOR)', async () => {
    const llm = new MockLLMProvider('openai', { structured: EMPTY_REVIEW });
    const app = await appWith(llm);

    const [otherWs] = await pg.handle.db
      .insert(t.workspaces)
      .values({ name: `other-ws-${repoSeq++}` })
      .returning();
    const { pr, agent } = await setupWorkspaceRepoPrAgent(pg.handle.db, otherWs!.id);
    const { finding } = await createReviewAndFinding(
      pg.handle.db,
      otherWs!.id,
      pr.id,
      agent.id,
      'accepted',
    );

    // Default auth (LocalNoAuthProvider) resolves the seeded default workspace,
    // which is NOT `otherWs` — the one-click lookup must reject cross-workspace.
    const res = await app.inject({ method: 'POST', url: `/findings/${finding.id}/eval-case` });
    expect(res.statusCode).toBe(404);

    await app.close();
  });

  it('list returns only this agent-in-this-workspace cases', async () => {
    const llm = new MockLLMProvider('openai', { structured: EMPTY_REVIEW });
    const app = await appWith(llm);
    const { agent: agentA } = await setupWorkspaceRepoPrAgent(pg.handle.db, workspaceId);
    const { agent: agentB } = await setupWorkspaceRepoPrAgent(pg.handle.db, workspaceId);

    await app.inject({
      method: 'POST',
      url: `/agents/${agentA.id}/eval-cases`,
      payload: { name: 'case A1', input_diff: DIFF, expected_output: [] },
    });
    await app.inject({
      method: 'POST',
      url: `/agents/${agentA.id}/eval-cases`,
      payload: { name: 'case A2', input_diff: DIFF, expected_output: [] },
    });
    await app.inject({
      method: 'POST',
      url: `/agents/${agentB.id}/eval-cases`,
      payload: { name: 'case B1', input_diff: DIFF, expected_output: [] },
    });

    const resA = await app.inject({ method: 'GET', url: `/agents/${agentA.id}/eval-cases` });
    expect(resA.statusCode).toBe(200);
    const casesA = resA.json();
    expect(casesA).toHaveLength(2);
    expect(casesA.map((c: { name: string }) => c.name).sort()).toEqual(['case A1', 'case A2']);
    expect(casesA.every((c: { owner_id: string }) => c.owner_id === agentA.id)).toBe(true);

    await app.close();
  });

  it('batch run scores N cases, persists a prompt+model snapshot, and issues exactly one provider call per case', async () => {
    const llm = new MockLLMProvider('openai', { structured: GROUNDED_REVIEW });
    const app = await appWith(llm);
    const { agent } = await setupWorkspaceRepoPrAgent(pg.handle.db, workspaceId);

    const caseNames = ['batch-case-1', 'batch-case-2', 'batch-case-3'];
    for (const name of caseNames) {
      await app.inject({
        method: 'POST',
        url: `/agents/${agent.id}/eval-cases`,
        payload: {
          name,
          input_diff: DIFF,
          expected_output: [
            {
              severity: 'CRITICAL',
              category: 'security',
              title: 'Hardcoded secret',
              file: 'src/config.ts',
              start_line: 11,
              end_line: 11,
            },
          ],
        },
      });
    }

    const res = await app.inject({ method: 'POST', url: `/agents/${agent.id}/eval-runs` });
    expect(res.statusCode).toBe(200);
    const run = res.json();
    expect(run.traces_total).toBe(3);
    expect(run.traces_passed).toBe(3);
    expect(run.recall).toBe(1);
    expect(run.precision).toBe(1);
    expect(run.per_trace).toHaveLength(3);

    const structuredCalls = llm.calls.filter((c) => c.method === 'completeStructured');
    expect(structuredCalls).toHaveLength(3);

    const rows = await pg.handle.db
      .select({ run: t.evalRuns, caseId: t.evalCases.id })
      .from(t.evalRuns)
      .innerJoin(t.evalCases, eq(t.evalRuns.caseId, t.evalCases.id))
      .where(eq(t.evalCases.ownerId, agent.id));
    expect(rows).toHaveLength(3);
    for (const row of rows) {
      const snapshot = (row.run.actualOutput as { prompt_snapshot?: { system_prompt: string; model: string } })
        .prompt_snapshot;
      expect(snapshot).toEqual({ system_prompt: agent.systemPrompt, model: agent.model });
    }

    await app.close();
  });

  it('single-case run returns an EvalRunResult', async () => {
    const llm = new MockLLMProvider('openai', { structured: GROUNDED_REVIEW });
    const app = await appWith(llm);
    const { agent } = await setupWorkspaceRepoPrAgent(pg.handle.db, workspaceId);

    const created = await (
      await app.inject({
        method: 'POST',
        url: `/agents/${agent.id}/eval-cases`,
        payload: {
          name: 'single-case',
          input_diff: DIFF,
          expected_output: [
            {
              severity: 'CRITICAL',
              category: 'security',
              title: 'Hardcoded secret',
              file: 'src/config.ts',
              start_line: 11,
              end_line: 11,
            },
          ],
        },
      })
    ).json();

    const res = await app.inject({ method: 'POST', url: `/eval-cases/${created.id}/run` });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.case_id).toBe(created.id);
    expect(typeof body.run_id).toBe('string');
    expect(body.result.traces_total).toBe(1);
    expect(body.result.traces_passed).toBe(1);
    expect(body.result.per_trace).toHaveLength(1);

    await app.close();
  });

  it('run history is chronological', async () => {
    const llm = new MockLLMProvider('openai', { structured: GROUNDED_REVIEW });
    const app = await appWith(llm);
    const { agent } = await setupWorkspaceRepoPrAgent(pg.handle.db, workspaceId);

    const created = await (
      await app.inject({
        method: 'POST',
        url: `/agents/${agent.id}/eval-cases`,
        payload: { name: 'history-case', input_diff: DIFF, expected_output: [] },
      })
    ).json();

    await app.inject({ method: 'POST', url: `/eval-cases/${created.id}/run` });
    await app.inject({ method: 'POST', url: `/eval-cases/${created.id}/run` });
    await app.inject({ method: 'POST', url: `/eval-cases/${created.id}/run` });

    const res = await app.inject({ method: 'GET', url: `/eval-cases/${created.id}/runs` });
    expect(res.statusCode).toBe(200);
    const history = res.json();
    expect(history).toHaveLength(3);
    const timestamps = history.map((r: { ran_at: string }) => r.ran_at);
    const sorted = [...timestamps].sort();
    expect(timestamps).toEqual(sorted);

    await app.close();
  });

  it('one failing case is fail-soft: the rest of the batch is still scored (AC-19)', async () => {
    const FAIL_MARKER = 'FAIL_ME_MARKER_XYZ';
    const llm = new FlakyLLMProvider(FAIL_MARKER, GROUNDED_REVIEW);
    const app = await appWith(llm);
    const { agent } = await setupWorkspaceRepoPrAgent(pg.handle.db, workspaceId);

    const okExpected = [
      {
        severity: 'CRITICAL',
        category: 'security',
        title: 'Hardcoded secret',
        file: 'src/config.ts',
        start_line: 11,
        end_line: 11,
      },
    ];

    // A diff carrying the marker string inside a comment addition — it still
    // parses (parseUnifiedDiff never throws), but the marker shows up in the
    // assembled prompt, so FlakyLLMProvider throws for THIS case only.
    const FAILING_DIFF = `diff --git a/src/config.ts b/src/config.ts
--- a/src/config.ts
+++ b/src/config.ts
@@ -10,3 +10,4 @@
   port: 3000,
+  // ${FAIL_MARKER}
   redisUrl: x,`;

    await app.inject({
      method: 'POST',
      url: `/agents/${agent.id}/eval-cases`,
      payload: { name: 'ok-case', input_diff: DIFF, expected_output: okExpected },
    });
    await app.inject({
      method: 'POST',
      url: `/agents/${agent.id}/eval-cases`,
      payload: { name: 'failing-case', input_diff: FAILING_DIFF, expected_output: okExpected },
    });

    const res = await app.inject({ method: 'POST', url: `/agents/${agent.id}/eval-runs` });
    expect(res.statusCode).toBe(200);
    const run = res.json();
    expect(run.traces_total).toBe(2);
    expect(run.traces_passed).toBe(1);

    const passTrace = run.per_trace.find((tr: { name: string }) => tr.name === 'ok-case');
    const failTrace = run.per_trace.find((tr: { name: string }) => tr.name === 'failing-case');
    expect(passTrace.pass).toBe(true);
    expect(failTrace.pass).toBe(false);

    await app.close();
  });

  it('agent dashboard and workspace overview shapes, including an agent with zero runs (neutral state)', async () => {
    const llm = new MockLLMProvider('openai', { structured: GROUNDED_REVIEW });
    const app = await appWith(llm);
    const { agent: activeAgent } = await setupWorkspaceRepoPrAgent(pg.handle.db, workspaceId);
    const { agent: idleAgent } = await setupWorkspaceRepoPrAgent(pg.handle.db, workspaceId);

    await app.inject({
      method: 'POST',
      url: `/agents/${activeAgent.id}/eval-cases`,
      payload: {
        name: 'dash-case',
        input_diff: DIFF,
        expected_output: [
          {
            severity: 'CRITICAL',
            category: 'security',
            title: 'Hardcoded secret',
            file: 'src/config.ts',
            start_line: 11,
            end_line: 11,
          },
        ],
      },
    });
    await app.inject({ method: 'POST', url: `/agents/${activeAgent.id}/eval-runs` });

    // Zero-runs agent dashboard: neutral state, not an error.
    const idleDashRes = await app.inject({ method: 'GET', url: `/agents/${idleAgent.id}/eval-dashboard` });
    expect(idleDashRes.statusCode).toBe(200);
    const idleDash = idleDashRes.json();
    expect(idleDash.cases_total).toBe(0);
    expect(idleDash.current).toEqual({
      recall: 1,
      precision: 1,
      citation_accuracy: 1,
      traces_passed: 0,
      traces_total: 0,
      cost_usd: null,
    });
    expect(idleDash.alert).toBeNull();

    const activeDashRes = await app.inject({ method: 'GET', url: `/agents/${activeAgent.id}/eval-dashboard` });
    expect(activeDashRes.statusCode).toBe(200);
    const activeDash = activeDashRes.json();
    expect(activeDash.cases_total).toBe(1);
    expect(activeDash.current.traces_total).toBe(1);
    expect(activeDash.current.traces_passed).toBe(1);
    expect(activeDash.recent_runs.length).toBeGreaterThanOrEqual(1);

    // Workspace overview: one EvalAgentSummary per review agent, both present.
    const overviewRes = await app.inject({ method: 'GET', url: '/eval/dashboard' });
    expect(overviewRes.statusCode).toBe(200);
    const overview = overviewRes.json();
    const activeSummary = overview.agents.find((a: { agent_id: string }) => a.agent_id === activeAgent.id);
    const idleSummary = overview.agents.find((a: { agent_id: string }) => a.agent_id === idleAgent.id);
    expect(activeSummary).toBeDefined();
    expect(idleSummary).toBeDefined();
    expect(activeSummary.traces_total).toBe(1);
    expect(idleSummary.traces_total).toBe(0);
    expect(idleSummary.recall).toBe(1);
    expect(overview.recent_runs.length).toBeGreaterThanOrEqual(1);

    await app.close();
  });
});
