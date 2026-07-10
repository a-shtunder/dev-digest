import type { Container } from '../../platform/container.js';
import type { FindingActionKind, RunEventKind, RunTrace } from '@devdigest/shared';
import { AppError, NotFoundError } from '../../platform/errors.js';
import type { AgentRow } from '../../db/rows.js';
import { ReviewRepository, type PullRow } from './repository.js';
import { type ReviewDto, type ReviewDtoFinding } from './helpers.js';
import { ReviewRunExecutor, type Logger } from './run-executor.js';
import { actOnFinding as actOnFindingImpl } from './findings.js';
import { reviewToDto } from './helpers.js';

// Re-export DTO types + converters for backward-compatible imports from
// './service.js' (these previously lived here; logic now in ./helpers.ts).
export { findingRowToDto, reviewToDto } from './helpers.js';
export type { ReviewDto, ReviewDtoFinding } from './helpers.js';

/**
 * Review service (the core). Orchestrates:
 *   diff → assemblePrompt(system + repo-map + diff)
 *        → llm.completeStructured({ schema: Review }) (single-pass)
 *        → groundFindings(...) (citation gate — drops findings off the diff)
 *        → persist reviews + kept findings (+ grounding summary)
 *   while streaming RunEvents over container.runBus, and on completion writing
 *   the whole log as ONE RunTrace doc + an agent_runs row.
 *
 * Also: the finding accept/dismiss actions. The bulky run execution lives in
 * run-executor; this class keeps the public method surface.
 */
export class ReviewService {
  private repo: ReviewRepository;
  private agents: Container['agentsRepo'];
  private executor: ReviewRunExecutor;

  constructor(private container: Container) {
    this.repo = new ReviewRepository(container.db);
    this.agents = container.agentsRepo;
    this.executor = new ReviewRunExecutor(container, this.repo, this.agents);
  }

  // ===========================================================================
  // Run a review for one or all enabled agents on a PR.
  // ===========================================================================

  /**
   * Resolve which agents to run. `all` → all enabled agents; else a single agent.
   */
  async resolveTargets(
    workspaceId: string,
    opts: { agentId?: string; all?: boolean },
  ): Promise<AgentRow[]> {
    if (opts.all) return this.agents.listEnabled(workspaceId);
    if (opts.agentId) {
      const agent = await this.agents.getById(workspaceId, opts.agentId);
      if (!agent) throw new NotFoundError('Agent not found');
      return [agent];
    }
    throw new AppError('invalid_run_request', 'Provide agentId or all:true', 400);
  }

  /** Delete a whole review run (one agent's pass) + its findings (cascade). */
  async deleteReview(workspaceId: string, reviewId: string): Promise<boolean> {
    return this.repo.deleteReview(workspaceId, reviewId);
  }

  /** In-flight runs for a PR (server-side source of truth, survives reload). */
  async activeRuns(workspaceId: string, prId: string) {
    return this.repo.activeRunsForPull(workspaceId, prId);
  }

  /** All runs for a PR (any status), newest first — the run history (incl. failures). */
  async listRuns(workspaceId: string, prId: string) {
    return this.repo.listRunsForPull(workspaceId, prId);
  }

  /** Delete one run from the history (+ its trace). */
  async deleteRun(workspaceId: string, runId: string): Promise<boolean> {
    return this.repo.deleteAgentRun(workspaceId, runId);
  }

  /**
   * Cancel an in-flight run. Signals a live runner to stop at its next
   * checkpoint AND marks the DB row cancelled + completes the bus immediately —
   * so cancel also works for ORPHANED runs (whose background process died on a
   * server restart) where signalling alone would do nothing.
   */
  async cancelRun(runId: string): Promise<void> {
    this.publish(runId, 'info', 'Cancellation requested — stopping…');
    this.container.runBus.cancel(runId);
    await this.repo.cancelRunIfRunning(runId);
    this.container.runBus.complete(runId);
  }

  /** Reap runs left 'running' by a previous (now-dead) process. Called on boot. */
  async reapStaleRuns(): Promise<number> {
    return this.repo.reapStaleRunningRuns();
  }

  /**
   * Create the agent_run rows up front so a runId is available IMMEDIATELY —
   * shared by `runReview` (fire-and-forget, HTTP/SSE) and `runReviewAndWait`
   * (MCP — awaits completion instead).
   */
  private async createRunsForTargets(
    workspaceId: string,
    prId: string,
    targets: AgentRow[],
  ): Promise<{
    runs: { run_id: string; agent_id: string; agent_name: string }[];
    jobs: { agent: AgentRow; runId: string }[];
  }> {
    const runs: { run_id: string; agent_id: string; agent_name: string }[] = [];
    const jobs: { agent: AgentRow; runId: string }[] = [];
    for (const agent of targets) {
      const runId = await this.repo.createAgentRun({
        workspaceId,
        agentId: agent.id,
        prId,
        provider: agent.provider,
        model: agent.model,
      });
      runs.push({ run_id: runId, agent_id: agent.id, agent_name: agent.name });
      jobs.push({ agent, runId });
    }
    return { runs, jobs };
  }

  /**
   * Run a review for each target agent. Each agent gets its own runId
   * (= agent_runs.id) created up-front so the SSE route can be subscribed
   * before/while the run progresses. A partial failure in one agent does not
   * abort the others.
   */
  async runReview(
    workspaceId: string,
    prId: string,
    targets: AgentRow[],
    logger?: Logger,
  ): Promise<{ runs: { run_id: string; agent_id: string; agent_name: string }[]; reviews: ReviewDto[] }> {
    const pull = await this.repo.getPull(workspaceId, prId);
    if (!pull) throw new NotFoundError('Pull request not found');
    const repo = await this.repo.getRepo(pull.repoId);
    if (!repo) throw new NotFoundError('Repo not found');

    // Create the agent_run rows up front so a runId is available IMMEDIATELY —
    // the client persists these in global state and subscribes to the SSE
    // stream. The actual (slow) review runs in the background below.
    const { runs, jobs } = await this.createRunsForTargets(workspaceId, prId, targets);

    // Fire-and-forget: the HTTP response returns now with the runIds; reviews
    // are persisted as each agent finishes and the client refetches on SSE done.
    void this.executor.executeRuns(workspaceId, pull, repo, jobs, logger).catch((err) => {
      logger?.error({ prId, err: (err as Error).message }, 'review: background execution crashed');
    });

    return { runs, reviews: [] };
  }

  /**
   * MCP — run a review for each target agent and BLOCK until every job
   * reaches a terminal state (unlike `runReview`, which fires-and-forgets for
   * the HTTP/SSE UI). Returns a concise per-run summary, not full findings —
   * callers fetch details via `findingsForRun`/`get_findings`.
   */
  async runReviewAndWait(
    workspaceId: string,
    prId: string,
    targets: AgentRow[],
    logger?: Logger,
  ): Promise<
    {
      run_id: string;
      agent_id: string;
      agent_name: string;
      status: string;
      verdict: string | null;
      score: number | null;
      findings_count: number;
      blockers: number | null;
      error?: string | null;
    }[]
  > {
    const pull = await this.repo.getPull(workspaceId, prId);
    if (!pull) throw new NotFoundError('Pull request not found');
    const repo = await this.repo.getRepo(pull.repoId);
    if (!repo) throw new NotFoundError('Repo not found');

    const { runs, jobs } = await this.createRunsForTargets(workspaceId, prId, targets);

    // AWAIT (not fire-and-forget) — executeRuns catches per-agent failures
    // internally, so this always resolves once every job is terminal.
    await this.executor.executeRuns(workspaceId, pull, repo, jobs, logger);

    return Promise.all(
      runs.map(async ({ run_id, agent_id, agent_name }) => {
        const result = await this.findingsForRun(workspaceId, run_id);
        if (result.status === 'done') {
          return {
            run_id,
            agent_id,
            agent_name,
            status: result.status,
            verdict: result.review.verdict,
            score: result.review.score,
            findings_count: result.review.findings.length,
            blockers: (await this.repo.getAgentRun(workspaceId, run_id))?.blockers ?? null,
          };
        }
        if (result.status === 'failed' || result.status === 'cancelled') {
          return {
            run_id,
            agent_id,
            agent_name,
            status: result.status,
            verdict: null,
            score: null,
            findings_count: 0,
            blockers: null,
            error: result.error,
          };
        }
        // 'running' — should not normally happen since executeRuns already
        // settled every job, but guard rather than throw.
        return {
          run_id,
          agent_id,
          agent_name,
          status: result.status,
          verdict: null,
          score: null,
          findings_count: 0,
          blockers: null,
        };
      }),
    );
  }

  /**
   * Findings for a single run, keyed by run status:
   *   'running'             → still in progress, caller should retry later
   *   'failed'/'cancelled'  → { error }
   *   'done'                → the full ReviewDto (verdict/score/findings)
   * Used by `get_findings` (MCP) and internally by `runReviewAndWait`.
   */
  async findingsForRun(
    workspaceId: string,
    runId: string,
  ): Promise<
    | { run_id: string; status: 'running' }
    | { run_id: string; status: 'failed' | 'cancelled'; error: string | null }
    | { run_id: string; status: 'done'; review: ReviewDto }
  > {
    const run = await this.repo.getAgentRun(workspaceId, runId);
    if (!run) throw new NotFoundError('Run not found — check the run_id returned by run_agent_on_pr');

    if (run.status === 'running') return { run_id: runId, status: 'running' };
    if (run.status === 'failed' || run.status === 'cancelled') {
      return { run_id: runId, status: run.status, error: run.error };
    }

    const found = await this.repo.reviewByRunId(runId);
    if (!found) {
      // Race: run marked done but the review row hasn't landed yet — treat as
      // still-in-progress rather than crash.
      return { run_id: runId, status: 'running' };
    }
    const agentName = found.review.agentId
      ? ((await this.agents.getById(workspaceId, found.review.agentId))?.name ?? null)
      : null;
    return { run_id: runId, status: 'done', review: reviewToDto(found.review, found.findings, agentName) };
  }

  /**
   * Resolve a PR by its GitHub number within a repo (MCP flat-arg lookup).
   * `workspaceId` isn't used in the query itself — scoping is already
   * enforced by the caller resolving `repoId` within the workspace via
   * `RepoService.getByFullName` — but it's kept in the signature for
   * consistency with every other public method on this service.
   */
  async findPrByNumber(_workspaceId: string, repoId: string, number: number): Promise<PullRow | undefined> {
    return this.repo.getPullByRepoAndNumber(repoId, number);
  }

  private publish(runId: string, kind: RunEventKind, msg: string, data?: unknown) {
    return this.container.runBus.publish(runId, kind, msg, data);
  }

  // ===========================================================================
  // Finding actions
  // ===========================================================================

  async actOnFinding(
    workspaceId: string,
    findingId: string,
    action: FindingActionKind,
  ): Promise<{ finding: ReviewDtoFinding }> {
    return actOnFindingImpl(this.repo, workspaceId, findingId, action);
  }

  // ===========================================================================
  // Reads
  // ===========================================================================

  async reviewsForPull(workspaceId: string, prId: string): Promise<ReviewDto[]> {
    const pull = await this.repo.getPull(workspaceId, prId);
    if (!pull) throw new NotFoundError('Pull request not found');
    const rows = await this.repo.reviewsForPull(prId);
    const names = new Map<string, string>();
    for (const { review } of rows) {
      if (review.agentId && !names.has(review.agentId)) {
        const a = await this.agents.getById(workspaceId, review.agentId);
        if (a) names.set(review.agentId, a.name);
      }
    }
    return rows.map(({ review, findings }) =>
      reviewToDto(review, findings, review.agentId ? names.get(review.agentId) : null),
    );
  }

  async getRunTrace(runId: string): Promise<RunTrace | undefined> {
    return this.repo.getRunTrace(runId);
  }
}
