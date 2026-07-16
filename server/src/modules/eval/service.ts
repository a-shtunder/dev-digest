import { z } from 'zod';
import type { Container } from '../../platform/container.js';
import type { AgentRow } from '../../db/rows.js';
import type {
  EvalCase,
  EvalCaseInput,
  EvalRun,
  EvalRunResult,
  EvalRunRecord,
  EvalDashboard,
  EvalOverview,
  EvalAgentSummary,
  ExpectedFinding,
  Finding,
  Severity,
  FindingCategory,
  Provider,
  LLMProvider,
} from '@devdigest/shared';
import { Finding as FindingSchema, ExpectedFinding as ExpectedFindingSchema } from '@devdigest/shared';
import { reviewPullRequest, sliceDiff } from '@devdigest/reviewer-core';
import { parseUnifiedDiff } from '../../adapters/git/diff-parser.js';
import { NotFoundError, ValidationError } from '../../platform/errors.js';
import { REVIEW_STRATEGY } from '../reviews/constants.js';
import { loadDiff } from '../reviews/diff-loader.js';
import { EvalRepository } from './repository.js';
import { scoreCase, aggregate } from './scoring.js';

/**
 * The narrow slice of `EvalRepository`'s public API this service depends on.
 * Declared as a `Pick<>` (not the concrete class) so hermetic tests can pass
 * an in-memory double via the constructor's `repoOverride` without touching
 * `repository.ts` or needing a real Postgres — mirrors `ContainerOverrides`'
 * DI-override pattern for adapters.
 */
export type EvalRepoPort = Pick<
  EvalRepository,
  | 'createCase'
  | 'getCase'
  | 'updateCase'
  | 'deleteCase'
  | 'listCasesForAgent'
  | 'insertRun'
  | 'listRunsForCase'
  | 'latestRunsForAgent'
  | 'previousRunsForAgent'
  | 'trendForAgent'
  | 'recentRunsForAgent'
  | 'recentRunsForWorkspace'
>;

/**
 * T4 — Eval orchestration service (L06). Resolves inputs via `container.*`
 * getters (never another module's repository directly), runs cases through
 * `reviewPullRequest` (the ONLY LLM call site on this path), scores results
 * with the pure `scoring.ts` helpers, and persists via `EvalRepository`.
 */

// ---- Locally-reconstructed run data (rides `eval_runs.actual_output`) -----
//
// Every persisted run stores `{ produced, expected, kept, dropped }` in
// addition to the prompt snapshot T3 already writes, so the dashboard's
// "current" figure can be recomputed as a true micro-average later (per the
// design note left by T3) instead of trusting the repository's per-batch
// `AVG()`-based trend, which is only an approximation.
const StoredRunDataSchema = z
  .object({
    produced: z.array(FindingSchema).catch([]),
    expected: z.array(ExpectedFindingSchema).catch([]),
    kept: z.number().catch(0),
    dropped: z.number().catch(0),
  })
  .catchall(z.unknown());

interface StoredRunData {
  produced: Finding[];
  expected: ExpectedFinding[];
  kept: number;
  dropped: number;
}

interface PooledItem extends StoredRunData {
  pass: boolean;
}

interface CaseExecutionResult {
  runId: string;
  name: string;
  expected: ExpectedFinding[];
  produced: Finding[];
  kept: number;
  dropped: number;
  pass: boolean;
  recall: number;
  precision: number;
  citationAccuracy: number;
  durationMs: number;
  costUsd: number | null;
  error?: string;
}

export class EvalService {
  private repo: EvalRepoPort;

  constructor(
    private container: Container,
    repoOverride?: EvalRepoPort,
  ) {
    this.repo = repoOverride ?? new EvalRepository(container.db);
  }

  // ---- Case creation ----------------------------------------------------

  /**
   * One-click: resolve finding -> review -> pull (workspace-scoped), slice the
   * PR diff around the finding's file (`sliceDiff`), and build a case whose
   * `expected_output` is the finding's skeleton (accepted) or `[]` (dismissed).
   * Rejects a finding with neither `acceptedAt` nor `dismissedAt` — there is
   * no way to tell which expectation shape to build.
   */
  async createFromFinding(workspaceId: string, findingId: string): Promise<EvalCase> {
    const ctx = await this.container.reviewRepo.findingContext(findingId);
    if (!ctx || ctx.pull.workspaceId !== workspaceId) {
      throw new NotFoundError('Finding not found');
    }
    const { finding, review, pull } = ctx;

    if (!finding.acceptedAt && !finding.dismissedAt) {
      throw new ValidationError(
        'Finding has no accept/dismiss decision — cannot determine the expected eval outcome',
      );
    }
    if (!review.agentId) {
      throw new ValidationError('Finding review has no agent — cannot attach an eval case to it');
    }

    const repoRow = await this.container.reviewRepo.getRepo(pull.repoId);
    if (!repoRow) throw new NotFoundError('Repo not found');

    const diff = await loadDiff(this.container, this.container.reviewRepo, workspaceId, pull, repoRow);
    const inputDiff = sliceDiff(diff, finding.file);

    const expectedOutput: ExpectedFinding[] = finding.acceptedAt
      ? [
          {
            severity: finding.severity as Severity,
            category: finding.category as FindingCategory,
            title: finding.title,
            file: finding.file,
            start_line: finding.startLine,
            end_line: finding.endLine,
          },
        ]
      : [];

    return this.repo.createCase(workspaceId, {
      owner_kind: 'agent',
      owner_id: review.agentId,
      name: finding.title,
      input_diff: inputDiff,
      expected_output: expectedOutput,
      notes: `Created from finding ${finding.id} (${finding.acceptedAt ? 'accepted' : 'dismissed'})`,
    });
  }

  /** Generic create — persists an already-validated `EvalCaseInput` as-is. */
  async createCase(workspaceId: string, input: EvalCaseInput): Promise<EvalCase> {
    return this.repo.createCase(workspaceId, input);
  }

  /** Fetches a single eval case, workspace-scoped. Throws `NotFoundError` if
   *  it doesn't exist or belongs to a different workspace. */
  async getCase(workspaceId: string, caseId: string): Promise<EvalCase> {
    const kase = await this.repo.getCase(workspaceId, caseId);
    if (!kase) throw new NotFoundError('Eval case not found');
    return kase;
  }

  /** Updates an existing eval case in place, workspace-scoped. Throws
   *  `NotFoundError` if the case doesn't exist or doesn't belong to this
   *  workspace — same IDOR discipline as `createFromFinding`'s check. */
  async updateCase(
    workspaceId: string,
    caseId: string,
    input: EvalCaseInput,
  ): Promise<EvalCase> {
    const updated = await this.repo.updateCase(workspaceId, caseId, input);
    if (!updated) throw new NotFoundError('Eval case not found');
    return updated;
  }

  /** All `owner_kind='agent'` cases for this agent, scoped to the workspace. */
  async listCasesForAgent(workspaceId: string, agentId: string): Promise<EvalCase[]> {
    return this.repo.listCasesForAgent(workspaceId, agentId);
  }

  async deleteCase(workspaceId: string, caseId: string): Promise<void> {
    const deleted = await this.repo.deleteCase(workspaceId, caseId);
    if (!deleted) throw new NotFoundError('Eval case not found');
  }

  // ---- Runs ---------------------------------------------------------------

  /**
   * Run every case in the agent's set through `reviewPullRequest` (one real
   * LLM call per case, agent's own provider + linked skills), score each with
   * `scoring.ts`, and persist one `eval_runs` row per case sharing ONE `ranAt`
   * timestamp so the repository's dashboard reads group them into one batch.
   * Fail-soft: a throwing/timing-out case is marked fail/error and the rest
   * of the set still runs.
   */
  async runSet(workspaceId: string, agentId: string): Promise<EvalRun> {
    const agent = await this.container.agentsRepo.getById(workspaceId, agentId);
    if (!agent) throw new NotFoundError('Agent not found');

    const cases = await this.repo.listCasesForAgent(workspaceId, agentId);
    if (cases.length === 0) {
      return {
        recall: 1,
        precision: 1,
        citation_accuracy: 1,
        traces_passed: 0,
        traces_total: 0,
        duration_ms: 0,
        cost_usd: null,
        per_trace: [],
      };
    }

    const llm = await this.container.llm(agent.provider as Provider);
    const skillBodies = await this.loadSkillBodies(agent.id);
    const ranAt = new Date();

    const results: CaseExecutionResult[] = [];
    for (const kase of cases) {
      results.push(await this.executeCase(agent, llm, skillBodies, kase, ranAt));
    }

    const pooled = this.poolMetrics(
      results.map((r) => ({
        produced: r.produced,
        expected: r.expected,
        kept: r.kept,
        dropped: r.dropped,
        pass: r.pass,
      })),
    );
    const durationMs = results.reduce((sum, r) => sum + r.durationMs, 0);
    const costUsd = this.sumCost(results.map((r) => r.costUsd));

    return {
      recall: pooled.recall,
      precision: pooled.precision,
      citation_accuracy: pooled.citation_accuracy,
      traces_passed: pooled.traces_passed,
      traces_total: pooled.traces_total,
      duration_ms: durationMs,
      cost_usd: costUsd,
      per_trace: results.map((r) => ({
        name: r.name,
        pass: r.pass,
        expected: r.expected,
        actual: r.produced,
      })),
    };
  }

  /** Run exactly one case through the same reviewPullRequest+score+persist path. */
  async runCase(workspaceId: string, caseId: string): Promise<EvalRunResult> {
    const kase = await this.repo.getCase(workspaceId, caseId);
    if (!kase) throw new NotFoundError('Eval case not found');
    if (kase.owner_kind !== 'agent') {
      throw new ValidationError('Only agent-owned eval cases can be run');
    }

    const agent = await this.container.agentsRepo.getById(workspaceId, kase.owner_id);
    if (!agent) throw new NotFoundError('Agent not found');

    const llm = await this.container.llm(agent.provider as Provider);
    const skillBodies = await this.loadSkillBodies(agent.id);
    const ranAt = new Date();

    const result = await this.executeCase(agent, llm, skillBodies, kase, ranAt);

    const evalRun: EvalRun = {
      recall: result.recall,
      precision: result.precision,
      citation_accuracy: result.citationAccuracy,
      traces_passed: result.pass ? 1 : 0,
      traces_total: 1,
      duration_ms: result.durationMs,
      cost_usd: result.costUsd,
      per_trace: [
        { name: result.name, pass: result.pass, expected: result.expected, actual: result.produced },
      ],
    };

    return { run_id: result.runId, case_id: kase.id, result: evalRun };
  }

  /** Chronological run history for one case, workspace-scoped via the case. */
  async runHistory(workspaceId: string, caseId: string): Promise<EvalRunRecord[]> {
    return this.repo.listRunsForCase(workspaceId, caseId);
  }

  // ---- Dashboards -----------------------------------------------------

  async dashboard(workspaceId: string, agentId: string): Promise<EvalDashboard> {
    const agent = await this.container.agentsRepo.getById(workspaceId, agentId);
    if (!agent) throw new NotFoundError('Agent not found');

    const [cases, latestRuns, previousRuns, trend, recentRuns] = await Promise.all([
      this.repo.listCasesForAgent(workspaceId, agentId),
      this.repo.latestRunsForAgent(workspaceId, agentId),
      this.repo.previousRunsForAgent(workspaceId, agentId),
      this.repo.trendForAgent(workspaceId, agentId),
      this.repo.recentRunsForAgent(workspaceId, agentId),
    ]);

    const current = this.currentFromRows(latestRuns);
    const delta =
      previousRuns.length === 0
        ? { recall: 0, precision: 0, citation_accuracy: 0 }
        : (() => {
            const previous = this.currentFromRows(previousRuns);
            return {
              recall: current.recall - previous.recall,
              precision: current.precision - previous.precision,
              citation_accuracy: current.citation_accuracy - previous.citation_accuracy,
            };
          })();

    return {
      owner_kind: 'agent',
      owner_id: agentId,
      cases_total: cases.length,
      current,
      delta,
      trend,
      recent_runs: recentRuns,
      alert: this.buildAlert(delta),
    };
  }

  /** One `EvalAgentSummary` per review agent in the workspace, plus recent runs. */
  async overview(workspaceId: string): Promise<EvalOverview> {
    const agents = await this.container.agentsRepo.list(workspaceId);

    const agentSummaries: EvalAgentSummary[] = [];
    for (const agent of agents) {
      const [latestRuns, trend] = await Promise.all([
        this.repo.latestRunsForAgent(workspaceId, agent.id),
        this.repo.trendForAgent(workspaceId, agent.id),
      ]);
      const current = this.currentFromRows(latestRuns);
      agentSummaries.push({
        agent_id: agent.id,
        name: agent.name,
        recall: current.recall,
        precision: current.precision,
        citation_accuracy: current.citation_accuracy,
        traces_passed: current.traces_passed,
        traces_total: current.traces_total,
        trend,
      });
    }

    const recentRuns = await this.repo.recentRunsForWorkspace(workspaceId);
    return { agents: agentSummaries, recent_runs: recentRuns };
  }

  // ---- Private helpers --------------------------------------------------

  /** Resolved + ordered enabled skill bodies for an agent (mirrors
   *  `reviews/run-executor.ts`'s `runOneAgent` skill-loading recipe). */
  private async loadSkillBodies(agentId: string): Promise<string[]> {
    const linked = await this.container.agentsRepo.linkedSkills(agentId);
    return linked
      .filter((l) => l.skill.enabled)
      .map((l) => {
        const untrustedSources = ['imported_url', 'community'];
        if (untrustedSources.includes(l.skill.source)) {
          return `<untrusted source="skill:${l.skill.source}">\n${l.skill.body.replaceAll('</untrusted>', '<\\/untrusted>')}\n</untrusted>`;
        }
        return l.skill.body;
      });
  }

  /**
   * Run one case through `reviewPullRequest` (the sole LLM call site) and
   * score it with `scoring.ts`; persists an `eval_runs` row either way.
   * Fail-soft: a throw/timeout from parsing or `reviewPullRequest` is caught
   * here, persisted as a failed row, and returned as a fail/error result —
   * the caller (runSet/runCase) never sees an exception from this method.
   */
  private async executeCase(
    agent: AgentRow,
    llm: LLMProvider,
    skillBodies: string[],
    kase: EvalCase,
    ranAt: Date,
  ): Promise<CaseExecutionResult> {
    const start = Date.now();
    const expected = kase.expected_output as ExpectedFinding[];
    const promptSnapshot = { system_prompt: agent.systemPrompt, model: agent.model };

    try {
      const diff = parseUnifiedDiff(kase.input_diff);
      const outcome = await reviewPullRequest({
        systemPrompt: agent.systemPrompt,
        model: agent.model,
        diff,
        llm,
        strategy: agent.strategy ?? REVIEW_STRATEGY,
        ...(skillBodies.length > 0 ? { skills: skillBodies } : {}),
      });
      const durationMs = Date.now() - start;
      const produced = outcome.review.findings;
      const kept = produced.length;
      const dropped = outcome.dropped.length;
      const scored = scoreCase({ produced, expected, kept, dropped });

      const record = await this.repo.insertRun({
        caseId: kase.id,
        ranAt,
        pass: scored.pass,
        recall: scored.recall,
        precision: scored.precision,
        citationAccuracy: scored.citation_accuracy,
        durationMs,
        costUsd: outcome.costUsd,
        actualOutput: { produced, expected, kept, dropped },
        promptSnapshot,
      });

      return {
        runId: record.id,
        name: kase.name,
        expected,
        produced,
        kept,
        dropped,
        pass: scored.pass,
        recall: scored.recall,
        precision: scored.precision,
        citationAccuracy: scored.citation_accuracy,
        durationMs,
        costUsd: outcome.costUsd,
      };
    } catch (err) {
      const durationMs = Date.now() - start;
      const message = err instanceof Error ? err.message : String(err);

      const record = await this.repo.insertRun({
        caseId: kase.id,
        ranAt,
        pass: false,
        recall: null,
        precision: null,
        citationAccuracy: null,
        durationMs,
        costUsd: null,
        actualOutput: { produced: [], expected, kept: 0, dropped: 0, error: message },
        promptSnapshot,
      });

      return {
        runId: record.id,
        name: kase.name,
        expected,
        produced: [],
        kept: 0,
        dropped: 0,
        pass: false,
        recall: 0,
        precision: 0,
        citationAccuracy: 0,
        durationMs,
        costUsd: null,
        error: message,
      };
    }
  }

  /** Pool recall/precision/citation_accuracy via `scoring.ts`'s micro-average;
   *  `traces_passed`/`traces_total` are derived directly from each item's
   *  already-decided `pass` (never recomputed — a fail-soft error case must
   *  stay counted as failed even if its empty produced/expected would
   *  otherwise "match" trivially). */
  private poolMetrics(items: PooledItem[]): {
    recall: number;
    precision: number;
    citation_accuracy: number;
    traces_passed: number;
    traces_total: number;
  } {
    const agg = aggregate(items);
    return {
      recall: agg.recall,
      precision: agg.precision,
      citation_accuracy: agg.citation_accuracy,
      traces_passed: items.filter((i) => i.pass).length,
      traces_total: items.length,
    };
  }

  /** Reconstruct the exact micro-averaged "current" figure for a batch of
   *  persisted rows from the raw produced/expected/kept/dropped counts stored
   *  in each row's `actual_output` (see the design note at the top of this
   *  file) rather than trusting the repository's `AVG()`-based trend. */
  private currentFromRows(rows: EvalRunRecord[]): EvalDashboard['current'] {
    const items: PooledItem[] = rows.map((r) => ({
      ...this.parseStoredRun(r.actual_output),
      pass: r.pass === true,
    }));
    const pooled = this.poolMetrics(items);
    return { ...pooled, cost_usd: this.sumCost(rows.map((r) => r.cost_usd)) };
  }

  private parseStoredRun(actualOutput: unknown): StoredRunData {
    const parsed = StoredRunDataSchema.safeParse(actualOutput);
    if (!parsed.success) return { produced: [], expected: [], kept: 0, dropped: 0 };
    return {
      produced: parsed.data.produced,
      expected: parsed.data.expected,
      kept: parsed.data.kept,
      dropped: parsed.data.dropped,
    };
  }

  private sumCost(costs: (number | null)[]): number | null {
    if (costs.length === 0) return null;
    const known = costs.filter((c): c is number => c !== null);
    if (known.length === 0) return null;
    return known.reduce((sum, c) => sum + c, 0);
  }

  /** Simple regression alert: a meaningful recall/precision drop vs the
   *  previous batch. Null when there is nothing worth flagging. */
  private buildAlert(delta: { recall: number; precision: number; citation_accuracy: number }): string | null {
    const REGRESSION_THRESHOLD = 0.1;
    if (delta.recall <= -REGRESSION_THRESHOLD) {
      return `Recall dropped ${Math.round(Math.abs(delta.recall) * 100)} points vs the previous run`;
    }
    if (delta.precision <= -REGRESSION_THRESHOLD) {
      return `Precision dropped ${Math.round(Math.abs(delta.precision) * 100)} points vs the previous run`;
    }
    return null;
  }
}
