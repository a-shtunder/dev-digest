import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { startPg, dockerAvailable, type PgFixture } from './helpers/pg.js';
import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/platform/config.js';
import { seed } from '../src/db/seed.js';
import { MockLLMProvider } from '../src/adapters/mocks.js';
import { ReviewRepository } from '../src/modules/reviews/repository.js';
import * as t from '../src/db/schema.js';
import type { Finding } from '@devdigest/shared';

const hasDocker = await dockerAvailable();
const d = hasDocker ? describe : describe.skip;

const config = () => loadConfig({ ...process.env, NODE_ENV: 'test' } as NodeJS.ProcessEnv);

const FINDINGS: Finding[] = [
  {
    id: 'f-1',
    severity: 'CRITICAL',
    category: 'security',
    title: 'Hardcoded secret',
    file: 'src/middleware/ratelimit.ts',
    start_line: 12,
    end_line: 12,
    rationale: 'A secret is committed in source.',
    confidence: 0.9,
    kind: 'finding',
  },
  {
    id: 'f-2',
    severity: 'WARNING',
    category: 'bug',
    title: 'Possible off-by-one',
    file: 'src/middleware/ratelimit.ts',
    start_line: 5,
    end_line: 5,
    rationale: 'Loop bound looks off.',
    confidence: 0.6,
    kind: 'finding',
  },
];

d('smart-diff (Testcontainers pg)', () => {
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

  it('GET /pulls/:id/smart-diff returns roles grouped + finding_lines (pseudocode_summary always null — not persisted yet) with 0 LLM calls', async () => {
    const llmMock = new MockLLMProvider('openai', { structured: {} });
    const app = await buildApp({
      config: config(),
      db: pg.handle.db,
      overrides: { llm: { openai: llmMock } },
    });

    // seed repo + PR + files
    const [repo] = await pg.handle.db
      .insert(t.repos)
      .values({ workspaceId, owner: 'acme', name: 'smart-diff-repo', fullName: 'acme/smart-diff-repo' })
      .returning();
    const [pr] = await pg.handle.db
      .insert(t.pullRequests)
      .values({
        workspaceId,
        repoId: repo!.id,
        number: 501,
        title: 'Add rate limiting middleware',
        author: 'marisa.koch',
        branch: 'feat/rl',
        base: 'main',
        headSha: 'deadbeef',
        additions: 5,
        deletions: 1,
        filesCount: 3,
        status: 'needs_review',
        body: 'Adds middleware.',
      })
      .returning();

    await pg.handle.db.insert(t.prFiles).values([
      { prId: pr!.id, path: 'src/middleware/ratelimit.ts', additions: 40, deletions: 5, patch: '@@ core @@' },
      { prId: pr!.id, path: 'server.ts', additions: 3, deletions: 0, patch: '@@ wiring @@' },
      { prId: pr!.id, path: 'pnpm-lock.yaml', additions: 84, deletions: 0, patch: '@@ lock @@' },
    ]);

    const repository = new ReviewRepository(pg.handle.db);
    const review = await repository.insertReview({
      workspaceId,
      prId: pr!.id,
      agentId: null,
      runId: null,
      kind: 'review',
      verdict: 'request_changes',
      summary: 'Solid approach, but a secret is committed.',
      score: 65,
      model: 'gpt-4.1',
    });
    await repository.insertFindings(review.id, FINDINGS);

    const res = await app.inject({ method: 'GET', url: `/pulls/${pr!.id}/smart-diff` });
    expect(res.statusCode).toBe(200);
    const smartDiff = res.json();

    // roles grouped, core above boilerplate, empty roles skipped
    expect(smartDiff.groups.map((g: { role: string }) => g.role)).toEqual(['core', 'wiring', 'boilerplate']);

    const coreGroup = smartDiff.groups.find((g: { role: string }) => g.role === 'core');
    const coreFile = coreGroup.files.find(
      (f: { path: string }) => f.path === 'src/middleware/ratelimit.ts',
    );
    expect(coreFile.finding_lines).toEqual([5, 12]);
    // Not persisted in this PR (no `file_summaries` column) — always null.
    expect(coreFile.pseudocode_summary).toBeNull();

    const wiringGroup = smartDiff.groups.find((g: { role: string }) => g.role === 'wiring');
    const wiringFile = wiringGroup.files.find((f: { path: string }) => f.path === 'server.ts');
    expect(wiringFile.pseudocode_summary).toBeNull();
    expect(wiringFile.finding_lines).toEqual([]);

    const boilerplateGroup = smartDiff.groups.find((g: { role: string }) => g.role === 'boilerplate');
    expect(boilerplateGroup.files.map((f: { path: string }) => f.path)).toEqual(['pnpm-lock.yaml']);
    expect(boilerplateGroup.files[0].pseudocode_summary).toBeNull();

    // machine guarantee of "0 LLM calls" on the full Smart Diff path (backend
    // route → service → repository, never touches container.llm)
    expect(llmMock.calls.length).toBe(0);

    await app.close();
  });
});
