/**
 * T16 — run-executor project-context injection (T10 / AC-18..AC-24, AC-26).
 *
 * Hermetic: no real Postgres, no network. Uses a real temp directory as the
 * "clone" (so the T3/T5 guard + fs reads exercise real filesystem behavior),
 * a `MockLLMProvider` for the single LLM call, and hand-built fakes for the
 * `Container`/`ReviewRepository`/`AgentsRepository` surfaces the executor
 * actually touches (mirrors the `blast/service.test.ts` fake-container
 * pattern — stub only what's called).
 */
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { MockLLMProvider } from '../../adapters/mocks.js';
import { ReviewRunExecutor } from './run-executor.js';
import type { Container } from '../../platform/container.js';
import type { ReviewRepository, PullRow, FindingRow, ReviewRow } from './repository.js';
import type { AgentRow } from '../../db/rows.js';
import type { LinkedSkillRow } from '../agents/repository.js';
import { runBus } from '../../platform/sse.js';
import type { Finding } from '@devdigest/shared';

let cloneRoot: string;

beforeEach(async () => {
  cloneRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'run-exec-clone-'));
  await fs.mkdir(path.join(cloneRoot, 'docs'), { recursive: true });
  await fs.writeFile(path.join(cloneRoot, 'docs', 'spec-a.md'), '# Spec A\ninvariant text', 'utf8');
  await fs.writeFile(path.join(cloneRoot, 'docs', 'spec-b.md'), '# Spec B', 'utf8');
});

afterEach(async () => {
  await fs.rm(cloneRoot, { recursive: true, force: true });
});

function pullRow(overrides: Partial<PullRow> = {}): PullRow {
  return {
    id: 'pr-1',
    workspaceId: 'ws-1',
    repoId: 'repo-1',
    number: 42,
    title: 'Add feature',
    author: 'octocat',
    branch: 'feat/x',
    base: 'main',
    headSha: 'abc123',
    lastReviewedSha: null,
    additions: 1,
    deletions: 0,
    filesCount: 1,
    status: 'needs_review',
    body: null,
    openedAt: null,
    updatedAt: null,
    ...overrides,
  } as PullRow;
}

function repoRow() {
  return {
    id: 'repo-1',
    workspaceId: 'ws-1',
    owner: 'octo',
    name: 'demo',
    fullName: 'octo/demo',
    defaultBranch: 'main',
    clonePath: cloneRoot,
    lastPolledAt: null,
    createdBy: null,
    createdAt: new Date(),
  };
}

function agentRow(overrides: Partial<AgentRow> = {}): AgentRow {
  return {
    id: 'agent-1',
    workspaceId: 'ws-1',
    name: 'Reviewer',
    description: 'desc',
    provider: 'openai',
    model: 'gpt-4.1',
    systemPrompt: 'You are a reviewer.',
    outputSchema: null,
    enabled: true,
    version: 1,
    strategy: 'single-pass',
    ciFailOn: 'critical',
    repoIntel: false,
    attachedDocPaths: [],
    createdBy: null,
    ...overrides,
  } as AgentRow;
}

function skillRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'skill-1',
    workspaceId: 'ws-1',
    name: 'Skill',
    enabled: true,
    source: 'local',
    body: 'skill body',
    version: 1,
    evidenceFiles: null,
    threatLevel: 'safe',
    attachedDocPaths: [],
    ...overrides,
  };
}

/** Fake `ReviewRepository` — stubs only what `executeRuns`/`runOneAgent` call. */
function buildRepo(opts: { prFiles?: { path: string; patch: string | null }[] } = {}) {
  const savedTraces: { runId: string; trace: unknown }[] = [];
  const completedRuns: unknown[] = [];
  const insertedFindings: Finding[][] = [];
  const repo = {
    getPrFiles: async () =>
      opts.prFiles ?? [
        { path: 'src/a.ts', patch: '@@ -1,1 +1,2 @@\n line1\n+line2' },
      ],
    getIntent: async () => ({ intent: 'Add a feature', in_scope: [], out_of_scope: [] }),
    insertReview: async (): Promise<ReviewRow> =>
      ({ id: 'review-1' }) as ReviewRow,
    insertFindings: async (_reviewId: string, findings: Finding[]): Promise<FindingRow[]> => {
      insertedFindings.push(findings);
      return findings as unknown as FindingRow[];
    },
    markReviewed: async () => undefined,
    completeAgentRun: async (runId: string, values: unknown) => {
      completedRuns.push({ runId, values });
    },
    saveRunTrace: async (runId: string, trace: unknown) => {
      savedTraces.push({ runId, trace });
    },
  } as unknown as ReviewRepository;
  return { repo, savedTraces, completedRuns, insertedFindings };
}

/** Fake `Container` — a real `runBus` singleton (in-memory, stateless per runId)
 *  plus stubs for `git`, `llm`, and `agentsRepo.linkedSkills`. */
function buildContainer(opts: { llm: MockLLMProvider; linkedSkills: LinkedSkillRow[] }): Container {
  return {
    runBus,
    git: {
      clonePathFor: () => cloneRoot,
      diff: async () => {
        throw new Error('no real diff in this hermetic test — fall back to pr_files');
      },
    },
    llm: async () => opts.llm,
    agentsRepo: {
      linkedSkills: async () => opts.linkedSkills,
    },
  } as unknown as Container;
}

/** A valid, schema-conformant `Review` fixture for `completeStructured`. */
const REVIEW_FIXTURE = {
  verdict: 'approve',
  summary: 'Looks fine.',
  score: 92,
  findings: [],
};

describe('run-executor: project-context injection', () => {
  it('injects the union of agent + enabled-skill docs, deduped and in deterministic order', async () => {
    const llm = new MockLLMProvider('openai', { structured: REVIEW_FIXTURE });
    const linkedSkills: LinkedSkillRow[] = [
      {
        skill: skillRow({ attachedDocPaths: ['docs/spec-a.md', 'docs/spec-b.md'] }) as never,
        order: 0,
      },
    ];
    const container = buildContainer({ llm, linkedSkills });
    const { repo, savedTraces } = buildRepo();
    const executor = new ReviewRunExecutor(container, repo, container.agentsRepo);

    const agent = agentRow({ attachedDocPaths: ['docs/spec-a.md'] });
    await executor.executeRuns('ws-1', pullRow(), repoRow(), [{ agent, runId: 'run-1' }]);

    const trace = savedTraces[0]?.trace as {
      specs_read: string[];
      specs_missing: string[];
      prompt_assembly: { specs: string | null };
    };
    // Union: agent's ['docs/spec-a.md'] first, then the skill's paths with
    // 'docs/spec-a.md' deduped (first occurrence wins) — AC-18/19/21.
    expect(trace.specs_read).toEqual(['docs/spec-a.md', 'docs/spec-b.md']);
    expect(trace.specs_missing).toEqual([]);
    // reviewer-core already wraps + injects into `## Project context` — assert
    // the block is present and contains both docs' text (AC-20/29, no double
    // wrapping needed here).
    expect(trace.prompt_assembly.specs).toContain('invariant text');
    expect(trace.prompt_assembly.specs).toContain('# Spec B');
  });

  it('fail-soft: a stale path is skipped into specs_missing, survivors are still injected', async () => {
    const llm = new MockLLMProvider('openai', { structured: REVIEW_FIXTURE });
    const container = buildContainer({ llm, linkedSkills: [] });
    const { repo, savedTraces } = buildRepo();
    const executor = new ReviewRunExecutor(container, repo, container.agentsRepo);

    const agent = agentRow({ attachedDocPaths: ['docs/spec-a.md', 'docs/does-not-exist.md'] });
    await executor.executeRuns('ws-1', pullRow(), repoRow(), [{ agent, runId: 'run-2' }]);

    const trace = savedTraces[0]?.trace as { specs_read: string[]; specs_missing: string[] };
    expect(trace.specs_read).toEqual(['docs/spec-a.md']);
    expect(trace.specs_missing).toEqual(['docs/does-not-exist.md']);
    // Distinct arrays — a missing path never also appears in specs_read (AC-26).
    expect(trace.specs_read).not.toContain('docs/does-not-exist.md');
  });

  it('zero attached docs: omits the ## Project context section, specs_read is empty', async () => {
    const llm = new MockLLMProvider('openai', { structured: REVIEW_FIXTURE });
    const container = buildContainer({ llm, linkedSkills: [] });
    const { repo, savedTraces } = buildRepo();
    const executor = new ReviewRunExecutor(container, repo, container.agentsRepo);

    const agent = agentRow({ attachedDocPaths: [] });
    await executor.executeRuns('ws-1', pullRow(), repoRow(), [{ agent, runId: 'run-3' }]);

    const trace = savedTraces[0]?.trace as {
      specs_read: string[];
      specs_missing: string[];
      prompt_assembly: { specs: string | null; user: string };
    };
    expect(trace.specs_read).toEqual([]);
    expect(trace.specs_missing).toEqual([]);
    expect(trace.prompt_assembly.specs).toBeNull();
    expect(trace.prompt_assembly.user).not.toContain('## Project context');
  });

  it('the LLM provider call count is identical with and without attached docs (AC-24)', async () => {
    const llmWithDocs = new MockLLMProvider('openai', { structured: REVIEW_FIXTURE });
    const containerWithDocs = buildContainer({ llm: llmWithDocs, linkedSkills: [] });
    const { repo: repoWithDocs } = buildRepo();
    const executorWithDocs = new ReviewRunExecutor(containerWithDocs, repoWithDocs, containerWithDocs.agentsRepo);
    await executorWithDocs.executeRuns(
      'ws-1',
      pullRow(),
      repoRow(),
      [{ agent: agentRow({ attachedDocPaths: ['docs/spec-a.md'] }), runId: 'run-4' }],
    );

    const llmWithoutDocs = new MockLLMProvider('openai', { structured: REVIEW_FIXTURE });
    const containerWithoutDocs = buildContainer({ llm: llmWithoutDocs, linkedSkills: [] });
    const { repo: repoWithoutDocs } = buildRepo();
    const executorWithoutDocs = new ReviewRunExecutor(
      containerWithoutDocs,
      repoWithoutDocs,
      containerWithoutDocs.agentsRepo,
    );
    await executorWithoutDocs.executeRuns(
      'ws-1',
      pullRow(),
      repoRow(),
      [{ agent: agentRow({ attachedDocPaths: [] }), runId: 'run-5' }],
    );

    const callsWithDocs = llmWithDocs.calls.filter((c) => c.method === 'completeStructured');
    const callsWithoutDocs = llmWithoutDocs.calls.filter((c) => c.method === 'completeStructured');
    expect(callsWithDocs).toHaveLength(1);
    expect(callsWithoutDocs).toHaveLength(1);
    expect(callsWithDocs.length).toBe(callsWithoutDocs.length);
  });

  // T17 / AC-35 (Risk R-8) — a grounded finding that references the injected
  // architecture-invariant spec must survive `groundFindings()` rather than
  // being dropped. The e2e flow (09-project-context-invariant.flow.json) only
  // asserts injection *visibility* (spec attached → block present in the
  // prompt); it cannot deterministically assert a specific LLM finding since
  // there is no live LLM in agent-browser. This hermetic test closes that gap
  // with a `MockLLMProvider` finding whose file/line cite a real diff hunk.
  it('a grounded finding referencing the architecture-invariant violation survives groundFindings() (AC-35)', async () => {
    // Attached spec states the invariant: api/ must not import db/ directly.
    await fs.mkdir(path.join(cloneRoot, 'specs'), { recursive: true });
    await fs.writeFile(
      path.join(cloneRoot, 'specs', 'architecture.md'),
      '# Architecture invariants\n\nModule `api/` must not import `db/` directly.\n',
      'utf8',
    );

    // Diff violates the invariant: api/handler.ts adds a direct `db/` import.
    // Hunk header `@@ -1,1 +1,2 @@` + one context line + one added line means
    // the added import lands on new-side line 2 — a real hunk line the
    // grounding gate's line-index will contain.
    const violatingPatch =
      "@@ -1,1 +1,2 @@\n export function handler() {}\n+import { db } from '../db/client.js';";

    const violatingFinding: Finding = {
      id: 'finding-arch-1',
      severity: 'WARNING',
      category: 'bug',
      title: 'api/ imports db/ directly, violating the architecture invariant',
      file: 'api/handler.ts',
      start_line: 2,
      end_line: 2,
      rationale:
        "This line imports `db/client.js` directly from `api/handler.ts`. The attached architecture spec states module `api/` must not import `db/` directly.",
      suggestion: 'Route data access through a service/repository boundary instead of importing db/ directly.',
      confidence: 0.9,
    };

    const llm = new MockLLMProvider('openai', {
      structured: { ...REVIEW_FIXTURE, findings: [violatingFinding] },
    });
    const linkedSkills: LinkedSkillRow[] = [];
    const container = buildContainer({ llm, linkedSkills });
    const { repo, savedTraces, insertedFindings } = buildRepo({
      prFiles: [{ path: 'api/handler.ts', patch: violatingPatch }],
    });
    const executor = new ReviewRunExecutor(container, repo, container.agentsRepo);

    const agent = agentRow({ attachedDocPaths: ['specs/architecture.md'] });
    await executor.executeRuns('ws-1', pullRow(), repoRow(), [{ agent, runId: 'run-6' }]);

    // The spec was actually injected (companion assertion to the e2e flow).
    const trace = savedTraces[0]?.trace as {
      specs_read: string[];
      prompt_assembly: { specs: string | null };
      stats: { grounding: string; findings: number };
    };
    expect(trace.specs_read).toEqual(['specs/architecture.md']);
    expect(trace.prompt_assembly.specs).toContain('must not import `db/` directly');

    // The finding survived groundFindings() — it was passed to insertFindings
    // (post-grounding) rather than dropped, and the trace's grounding summary
    // + findings count agree that 1/1 findings passed the citation gate.
    expect(trace.stats.grounding).toBe('1/1 passed');
    expect(trace.stats.findings).toBe(1);
    expect(insertedFindings).toHaveLength(1);
    const survived = insertedFindings[0];
    expect(survived).toHaveLength(1);
    expect(survived?.[0]?.id).toBe('finding-arch-1');
    expect(survived?.[0]?.file).toBe('api/handler.ts');
    // References the violation, per Acceptance.
    expect(survived?.[0]?.rationale).toContain("db/client.js");
    expect(survived?.[0]?.title).toContain('violating the architecture invariant');
  });
});
