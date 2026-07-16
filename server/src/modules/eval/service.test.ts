import { describe, it, expect } from 'vitest';
import type {
  LLMProvider,
  StructuredRequest,
  StructuredResult,
  EvalCase,
  EvalCaseInput,
  EvalRunRecord,
  EvalTrendPoint,
} from '@devdigest/shared';
import type { AgentRow } from '../../db/rows.js';
import type { Container } from '../../platform/container.js';
import type { InsertEvalRunParams } from './repository.js';
import { EvalService, type EvalRepoPort } from './service.js';

/**
 * Hermetic service tests (T4). No Postgres, no real container — an in-memory
 * `EvalRepoPort` double stands in for `EvalRepository` (see the type's doc
 * comment in service.ts), and a hand-rolled `LLMProvider` stub stands in for
 * the injected provider so `reviewPullRequest` runs for real but never makes
 * a network call.
 */

// ---- Fixtures ---------------------------------------------------------

const DIFF_A = [
  'diff --git a/src/a.ts b/src/a.ts',
  '--- a/src/a.ts',
  '+++ b/src/a.ts',
  '@@ -1,2 +1,3 @@',
  ' context line',
  '+added line',
  ' context line 2',
].join('\n');

const DIFF_B = [
  'diff --git a/src/b.ts b/src/b.ts',
  '--- a/src/b.ts',
  '+++ b/src/b.ts',
  '@@ -1,2 +1,3 @@',
  ' context line',
  '+another added line',
  ' context line 2',
].join('\n');

function makeAgent(overrides: Partial<AgentRow> = {}): AgentRow {
  return {
    id: 'agent-1',
    workspaceId: 'ws-1',
    name: 'Test Agent',
    description: 'test',
    provider: 'openai',
    model: 'gpt-4.1',
    systemPrompt: 'Review the diff carefully.',
    outputSchema: null,
    strategy: 'single-pass',
    ciFailOn: 'critical',
    repoIntel: false,
    attachedDocPaths: [],
    enabled: true,
    version: 1,
    createdBy: null,
    createdAt: new Date(),
    ...overrides,
  } as unknown as AgentRow;
}

function makeContainer(agent: AgentRow, llm: LLMProvider): Container {
  return {
    db: {} as unknown,
    agentsRepo: {
      getById: async (_workspaceId: string, id: string) =>
        id === agent.id ? agent : undefined,
      list: async () => [agent],
      linkedSkills: async () => [],
    },
    reviewRepo: {},
    async llm() {
      return llm;
    },
  } as unknown as Container;
}

/** A `Review` fixture whose single finding lands on the diff's added line
 *  (`src/a.ts:2`) so it survives citation grounding. */
function reviewFixture(overrides: {
  findings?: unknown[];
} = {}) {
  return {
    verdict: 'comment',
    summary: 'looks fine',
    score: 90,
    findings:
      overrides.findings ??
      [
        {
          id: 'f1',
          severity: 'WARNING',
          category: 'bug',
          title: 'Suspicious line',
          file: 'src/a.ts',
          start_line: 2,
          end_line: 2,
          rationale: 'because',
          suggestion: null,
          confidence: 0.9,
          kind: 'finding',
        },
      ],
    walkthrough: null,
  };
}

/** Minimal `LLMProvider` stub: returns a caller-supplied fixture per call,
 *  optionally throwing when the assembled prompt contains `failMarker` (used
 *  for the fail-soft test). Records every call for call-count assertions. */
class StubLLMProvider implements LLMProvider {
  readonly id: 'openai' | 'anthropic' = 'openai';
  calls: unknown[] = [];

  constructor(
    private fixture: unknown,
    private failMarker?: string,
  ) {}

  async listModels() {
    return [];
  }

  async complete(): Promise<never> {
    throw new Error('complete() not used by reviewPullRequest');
  }

  async completeStructured<T>(req: StructuredRequest<T>): Promise<StructuredResult<T>> {
    this.calls.push(req);
    const text = JSON.stringify(req.messages);
    if (this.failMarker && text.includes(this.failMarker)) {
      throw new Error('Simulated LLM failure');
    }
    const parsed = (req.schema as { parse: (v: unknown) => T }).parse(this.fixture);
    return {
      data: parsed,
      model: req.model,
      tokensIn: 10,
      tokensOut: 10,
      costUsd: 0.001,
      raw: JSON.stringify(this.fixture),
      attempts: 1,
    };
  }

  async embed(texts: string[]): Promise<number[][]> {
    return texts.map(() => []);
  }
}

/** In-memory double for `EvalRepoPort` — no DB, no Postgres. */
class FakeEvalRepo implements EvalRepoPort {
  cases = new Map<string, EvalCase>();
  runs: EvalRunRecord[] = [];
  private nextCaseId = 1;
  private nextRunId = 1;

  async createCase(_workspaceId: string, input: EvalCaseInput): Promise<EvalCase> {
    const id = `case-${this.nextCaseId++}`;
    const kase: EvalCase = {
      id,
      owner_kind: input.owner_kind,
      owner_id: input.owner_id,
      name: input.name,
      input_diff: input.input_diff,
      input_files: input.input_files ?? null,
      input_meta: input.input_meta ?? null,
      expected_output: input.expected_output,
      notes: input.notes ?? null,
    };
    this.cases.set(id, kase);
    return kase;
  }

  async getCase(_workspaceId: string, caseId: string): Promise<EvalCase | undefined> {
    return this.cases.get(caseId);
  }

  async updateCase(
    _workspaceId: string,
    caseId: string,
    input: EvalCaseInput,
  ): Promise<EvalCase | undefined> {
    const existing = this.cases.get(caseId);
    if (!existing) return undefined;
    const updated: EvalCase = {
      ...existing,
      owner_kind: input.owner_kind,
      owner_id: input.owner_id,
      name: input.name,
      input_diff: input.input_diff,
      input_files: input.input_files ?? null,
      input_meta: input.input_meta ?? null,
      expected_output: input.expected_output,
      notes: input.notes ?? null,
    };
    this.cases.set(caseId, updated);
    return updated;
  }

  async deleteCase(_workspaceId: string, caseId: string): Promise<boolean> {
    return this.cases.delete(caseId);
  }

  async listCasesForAgent(_workspaceId: string, agentId: string): Promise<EvalCase[]> {
    return [...this.cases.values()].filter(
      (c) => c.owner_kind === 'agent' && c.owner_id === agentId,
    );
  }

  async insertRun(params: InsertEvalRunParams): Promise<EvalRunRecord> {
    const id = `run-${this.nextRunId++}`;
    const record: EvalRunRecord = {
      id,
      case_id: params.caseId,
      case_name: this.cases.get(params.caseId)?.name ?? null,
      ran_at: (params.ranAt ?? new Date()).toISOString(),
      actual_output: {
        ...(params.actualOutput ?? {}),
        prompt_snapshot: params.promptSnapshot ?? null,
      },
      pass: params.pass,
      recall: params.recall,
      precision: params.precision,
      citation_accuracy: params.citationAccuracy,
      duration_ms: params.durationMs,
      cost_usd: params.costUsd,
    };
    this.runs.push(record);
    return record;
  }

  async listRunsForCase(_workspaceId: string, caseId: string): Promise<EvalRunRecord[]> {
    return this.runs.filter((r) => r.case_id === caseId);
  }

  async latestRunsForAgent(): Promise<EvalRunRecord[]> {
    return this.runs;
  }

  async previousRunsForAgent(): Promise<EvalRunRecord[]> {
    return [];
  }

  async trendForAgent(): Promise<EvalTrendPoint[]> {
    return [];
  }

  async recentRunsForAgent(): Promise<EvalRunRecord[]> {
    return this.runs;
  }

  async recentRunsForWorkspace(): Promise<EvalRunRecord[]> {
    return this.runs;
  }
}

const WORKSPACE_ID = 'ws-1';

async function seedCase(
  repo: FakeEvalRepo,
  overrides: Partial<EvalCaseInput> = {},
): Promise<EvalCase> {
  return repo.createCase(WORKSPACE_ID, {
    owner_kind: 'agent',
    owner_id: 'agent-1',
    name: 'Case A',
    input_diff: DIFF_A,
    expected_output: [
      {
        severity: 'WARNING',
        category: 'bug',
        title: 'Suspicious line',
        file: 'src/a.ts',
        start_line: 2,
        end_line: 2,
      },
    ],
    ...overrides,
  });
}

// ---- Tests --------------------------------------------------------------

describe('EvalService.runSet', () => {
  it('runs one case through reviewPullRequest and scores it with exact metrics', async () => {
    const agent = makeAgent();
    const repo = new FakeEvalRepo();
    await seedCase(repo);

    const llm = new StubLLMProvider(reviewFixture());
    const service = new EvalService(makeContainer(agent, llm), repo);

    const result = await service.runSet(WORKSPACE_ID, agent.id);

    expect(result.traces_total).toBe(1);
    expect(result.traces_passed).toBe(1);
    expect(result.recall).toBe(1);
    expect(result.precision).toBe(1);
    expect(result.citation_accuracy).toBe(1);
    expect(result.per_trace).toHaveLength(1);
    expect(result.per_trace[0]?.pass).toBe(true);
    expect(llm.calls).toHaveLength(1);
    // exactly one eval_runs row persisted, carrying the config snapshot
    expect(repo.runs).toHaveLength(1);
    const snapshot = (repo.runs[0]?.actual_output as { prompt_snapshot?: unknown })
      ?.prompt_snapshot;
    expect(snapshot).toEqual({ system_prompt: agent.systemPrompt, model: agent.model });
  });

  it('AC-17: two stub LLMs returning different findings yield different recall/precision', async () => {
    const agent = makeAgent();

    // "Old prompt": the LLM finds the expected finding -> recall/precision 1.
    const repoOld = new FakeEvalRepo();
    await seedCase(repoOld);
    const llmOld = new StubLLMProvider(reviewFixture());
    const serviceOld = new EvalService(makeContainer(agent, llmOld), repoOld);
    const runOld = await serviceOld.runSet(WORKSPACE_ID, agent.id);

    // "New prompt": the LLM finds nothing -> recall drops to 0.
    const repoNew = new FakeEvalRepo();
    await seedCase(repoNew);
    const llmNew = new StubLLMProvider(reviewFixture({ findings: [] }));
    const serviceNew = new EvalService(makeContainer(agent, llmNew), repoNew);
    const runNew = await serviceNew.runSet(WORKSPACE_ID, agent.id);

    expect(runOld.recall).toBe(1);
    expect(runNew.recall).toBe(0);
    expect(runOld.recall).not.toBe(runNew.recall);
  });

  it('AC-19/AC-6: fail-soft — a throwing case leaves the others scored, zero extra provider calls', async () => {
    const agent = makeAgent();
    const repo = new FakeEvalRepo();
    await seedCase(repo, { name: 'Case A (ok)', input_diff: DIFF_A });
    await seedCase(repo, {
      name: 'Case B (fails)',
      input_diff: DIFF_B,
      expected_output: [
        {
          severity: 'WARNING',
          category: 'bug',
          title: 'Suspicious line',
          file: 'src/b.ts',
          start_line: 2,
          end_line: 2,
        },
      ],
    });

    // Throws whenever the assembled prompt contains the failing case's file.
    const llm = new StubLLMProvider(reviewFixture(), 'src/b.ts');
    const service = new EvalService(makeContainer(agent, llm), repo);

    const result = await service.runSet(WORKSPACE_ID, agent.id);

    expect(result.traces_total).toBe(2);
    expect(result.traces_passed).toBe(1); // only Case A passed
    // exactly one reviewPullRequest call per case — no retries beyond that.
    expect(llm.calls).toHaveLength(2);
    expect(repo.runs).toHaveLength(2);

    const failedTrace = result.per_trace.find((t) => t.name === 'Case B (fails)');
    expect(failedTrace?.pass).toBe(false);
    const failedRow = repo.runs.find((r) => r.case_name === 'Case B (fails)');
    expect(failedRow?.pass).toBe(false);
    expect(failedRow?.recall).toBeNull();

    const okTrace = result.per_trace.find((t) => t.name === 'Case A (ok)');
    expect(okTrace?.pass).toBe(true);
  });

  it('returns a neutral empty result for an agent with no cases (no LLM call)', async () => {
    const agent = makeAgent();
    const repo = new FakeEvalRepo();
    const llm = new StubLLMProvider(reviewFixture());
    const service = new EvalService(makeContainer(agent, llm), repo);

    const result = await service.runSet(WORKSPACE_ID, agent.id);

    expect(result.traces_total).toBe(0);
    expect(result.traces_passed).toBe(0);
    expect(result.recall).toBe(1);
    expect(llm.calls).toHaveLength(0);
  });
});

describe('EvalService.runCase', () => {
  it('runs exactly one case and returns an EvalRunResult', async () => {
    const agent = makeAgent();
    const repo = new FakeEvalRepo();
    const kase = await seedCase(repo);
    const llm = new StubLLMProvider(reviewFixture());
    const service = new EvalService(makeContainer(agent, llm), repo);

    const result = await service.runCase(WORKSPACE_ID, kase.id);

    expect(result.case_id).toBe(kase.id);
    expect(result.result.traces_total).toBe(1);
    expect(result.result.per_trace[0]?.pass).toBe(true);
    expect(llm.calls).toHaveLength(1);
  });
});

describe('EvalService.updateCase', () => {
  it('updates an existing case in place (same id, new fields)', async () => {
    const agent = makeAgent();
    const repo = new FakeEvalRepo();
    const kase = await seedCase(repo, { name: 'Original name' });
    const llm = new StubLLMProvider(reviewFixture());
    const service = new EvalService(makeContainer(agent, llm), repo);

    const updated = await service.updateCase(WORKSPACE_ID, kase.id, {
      owner_kind: 'agent',
      owner_id: agent.id,
      name: 'Renamed case',
      input_diff: DIFF_B,
      expected_output: [],
    });

    expect(updated.id).toBe(kase.id);
    expect(updated.name).toBe('Renamed case');
    expect(updated.input_diff).toBe(DIFF_B);
    expect(await repo.listCasesForAgent(WORKSPACE_ID, agent.id)).toHaveLength(1);
  });

  it('throws NotFoundError for a case that does not exist', async () => {
    const agent = makeAgent();
    const repo = new FakeEvalRepo();
    const llm = new StubLLMProvider(reviewFixture());
    const service = new EvalService(makeContainer(agent, llm), repo);

    await expect(
      service.updateCase(WORKSPACE_ID, 'missing-case', {
        owner_kind: 'agent',
        owner_id: agent.id,
        name: 'x',
        input_diff: '',
        expected_output: [],
      }),
    ).rejects.toThrow('Eval case not found');
  });
});

describe('EvalService.deleteCase', () => {
  it('deletes an existing case', async () => {
    const agent = makeAgent();
    const repo = new FakeEvalRepo();
    const kase = await seedCase(repo, { name: 'To be deleted' });
    const llm = new StubLLMProvider(reviewFixture());
    const service = new EvalService(makeContainer(agent, llm), repo);

    await service.deleteCase(WORKSPACE_ID, kase.id);

    expect(await repo.listCasesForAgent(WORKSPACE_ID, agent.id)).toHaveLength(0);
  });

  it('throws NotFoundError for a case that does not exist', async () => {
    const agent = makeAgent();
    const repo = new FakeEvalRepo();
    const llm = new StubLLMProvider(reviewFixture());
    const service = new EvalService(makeContainer(agent, llm), repo);

    await expect(service.deleteCase(WORKSPACE_ID, 'missing-case')).rejects.toThrow(
      'Eval case not found',
    );
  });
});

describe('EvalService.dashboard', () => {
  it('computes a micro-averaged current metric from persisted run rows', async () => {
    const agent = makeAgent();
    const repo = new FakeEvalRepo();
    // Case 1: expected 1, matched 1.
    await seedCase(repo, { name: 'Case 1' });
    // Case 2: expected 3 (only 1 will match) -> pooled recall should be 2/4 = 0.5.
    await seedCase(repo, {
      name: 'Case 2',
      input_diff: DIFF_A,
      expected_output: [
        { severity: 'WARNING', category: 'bug', title: 'a', file: 'src/a.ts', start_line: 2, end_line: 2 },
        { severity: 'WARNING', category: 'bug', title: 'b', file: 'src/a.ts', start_line: 20, end_line: 20 },
        { severity: 'WARNING', category: 'bug', title: 'c', file: 'src/a.ts', start_line: 30, end_line: 30 },
      ],
    });

    const llm = new StubLLMProvider(reviewFixture());
    const service = new EvalService(makeContainer(agent, llm), repo);
    await service.runSet(WORKSPACE_ID, agent.id);

    const dashboard = await service.dashboard(WORKSPACE_ID, agent.id);

    expect(dashboard.cases_total).toBe(2);
    // pooled: matched 2 of total 4 expected (1 from case1, 1 from case2's 3) -> 0.5,
    // NOT the per-case average (1 + 1/3) / 2 = 0.667.
    expect(dashboard.current.recall).toBeCloseTo(0.5);
    expect(dashboard.current.recall).not.toBeCloseTo((1 + 1 / 3) / 2);
  });

  it('an agent with no runs shows a neutral empty state, not an error', async () => {
    const agent = makeAgent();
    const repo = new FakeEvalRepo();
    const llm = new StubLLMProvider(reviewFixture());
    const service = new EvalService(makeContainer(agent, llm), repo);

    const dashboard = await service.dashboard(WORKSPACE_ID, agent.id);

    expect(dashboard.current.traces_total).toBe(0);
    expect(dashboard.alert).toBeNull();
  });
});

describe('EvalService.overview', () => {
  it('returns one summary per review agent, including agents with zero runs', async () => {
    const agent = makeAgent();
    const repo = new FakeEvalRepo();
    const llm = new StubLLMProvider(reviewFixture());
    const service = new EvalService(makeContainer(agent, llm), repo);

    const overview = await service.overview(WORKSPACE_ID);

    expect(overview.agents).toHaveLength(1);
    expect(overview.agents[0]?.agent_id).toBe(agent.id);
    expect(overview.agents[0]?.traces_total).toBe(0);
  });
});
