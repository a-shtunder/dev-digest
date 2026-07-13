/**
 * service.ts — BriefService: orchestration + single-flight for the Why+Risk
 * PR Brief Card.
 *
 * Onion layer: application layer — orchestrates repo + adapter + sibling
 * service reads only; no SQL and no adapter instantiation live here.
 *
 * - `getCached` — cache-hit path: resolves the PR + current head SHA, reads
 *   the stored brief; returns it with `generated: false` and ZERO LLM calls
 *   when the stored `head_sha` matches the PR's current head (AC-9). Cache
 *   miss (no stored row, or stale `head_sha`) returns null so the caller can
 *   fall through to `generate`.
 * - `generate` — always (re)computes. Single-flights concurrent calls for
 *   the same `prId+headSha` key via an in-process `Map<string, Promise<...>>`
 *   so a burst of concurrent "Regenerate" clicks coalesces into one LLM run
 *   (race-edge AC). Gathers already-computed inputs from read-only sibling
 *   services (intent, blast, smart-diff), resolves a best-effort linked
 *   issue, classifies the Brief (one structured call) then per-file core
 *   summaries (a second, independent, fail-soft call), validates/drops
 *   dangling refs via `helpers.ts` (logging every drop, AC-8), and persists
 *   via `BriefRepository`.
 *
 * Failure semantics:
 *   - Brief-call failure/invalid schema → `BriefClassificationError`
 *     propagates, cache is NOT written (AC-18, fail-closed).
 *   - Per-file summary failure → fail-soft: Brief itself still succeeds,
 *     `core_summaries` is written as `{}` (AC-17).
 */
import type { Container } from '../../platform/container.js';
import type { BlastRadiusResult, PrBriefResponse } from '@devdigest/shared';
import { NotFoundError } from '../../platform/errors.js';
import { ReviewRepository } from '../reviews/repository.js';
import type { PullRow } from '../reviews/repository.js';
import { IntentService } from '../intent/service.js';
import { BlastService } from '../blast/service.js';
import { SmartDiffService } from '../smart-diff/service.js';
import { parseReferences } from '../intent/references.js';
import { classifyBrief, classifyCoreFileSummaries, CoreFileSummaryError } from './classifier.js';
import { validateRisks, validateReviewFocus, deriveReviewFocusFromRisks } from './helpers.js';
import { BriefRepository } from './repository.js';
import type { Logger } from '../reviews/run-executor.js';

export interface GenerateBriefOpts {
  /** Advisory only — single-flight coalescing already de-dupes concurrent
   *  regenerate calls; this flag exists for callers/logging clarity. */
  regenerate?: boolean;
  logger?: Logger;
}

/** Module-level (per-process) single-flight map, keyed on `${prId}:${headSha}`.
 *  Concurrent `generate()` calls for the SAME head SHA coalesce into one
 *  in-flight promise. A new head SHA (new push) gets its own key — it is
 *  never coalesced with a stale in-flight generation for an older SHA. */
const inFlight = new Map<string, Promise<PrBriefResponse>>();

/**
 * Renders the degraded/stats-only `BlastRadiusResult` (repo-intel's flat
 * snake/camelCase shape) into a short stats-only text summary for the Brief
 * prompt (AC-2: stats/summaries only, never file/diff bodies). Never
 * includes caller code content — only counts and impacted endpoint paths.
 */
function renderBlastSummary(blast: BlastRadiusResult): string {
  if (blast.degraded) {
    return `Blast radius unavailable (${blast.reason ?? 'unknown reason'}).`;
  }
  const parts = [
    `${blast.changedSymbols.length} changed symbol(s)`,
    `${blast.callers.length} caller reference(s)`,
    `${blast.impactedEndpoints.length} impacted endpoint(s)${
      blast.impactedEndpoints.length > 0 ? `: ${blast.impactedEndpoints.join(', ')}` : ''
    }`,
  ];
  return parts.join('; ');
}

export class BriefService {
  private repo: ReviewRepository;
  private briefRepo: BriefRepository;

  constructor(private container: Container) {
    this.repo = new ReviewRepository(container.db);
    this.briefRepo = new BriefRepository(container.db);
  }

  /**
   * Cache-hit path (AC-9): resolves the PR's current head SHA, reads the
   * stored brief, and returns it with `generated: false` — zero LLM calls —
   * when the stored `head_sha` matches. Returns null on cache miss (no
   * stored row, or a stale `head_sha`) so the caller can fall through to
   * `generate`.
   */
  async getCached(workspaceId: string, prId: string): Promise<PrBriefResponse | null> {
    const pull = await this.repo.getPull(workspaceId, prId);
    if (!pull) throw new NotFoundError(`Pull request not found: ${prId}`);

    const cached = await this.briefRepo.get(prId);
    if (!cached || cached.headSha !== pull.headSha) return null;

    return { ...cached.json, generated: false };
  }

  /**
   * Always (re)computes the brief for the PR's current head SHA and
   * persists it. Single-flights concurrent calls for the same `prId+headSha`
   * key so a burst of "Regenerate" clicks results in exactly one LLM run.
   */
  async generate(
    workspaceId: string,
    prId: string,
    opts: GenerateBriefOpts = {},
  ): Promise<PrBriefResponse> {
    const pull = await this.repo.getPull(workspaceId, prId);
    if (!pull) throw new NotFoundError(`Pull request not found: ${prId}`);

    const key = `${prId}:${pull.headSha}`;
    const existing = inFlight.get(key);
    if (existing) return existing;

    const task = this.build(workspaceId, prId, pull, opts).finally(() => {
      inFlight.delete(key);
    });
    inFlight.set(key, task);
    return task;
  }

  // ---- private orchestration --------------------------------------------

  private async build(
    workspaceId: string,
    prId: string,
    pull: PullRow,
    opts: GenerateBriefOpts,
  ): Promise<PrBriefResponse> {
    const { logger } = opts;

    // 1. Gather already-computed inputs from read-only sibling services.
    //    None of these make an LLM call from here (intent may compute-once
    //    on first access, blast/smart-diff never call the LLM at all).
    const [intent, blast, smartDiff, files] = await Promise.all([
      new IntentService(this.container, logger).getOrCompute(workspaceId, prId),
      new BlastService(this.container).getForPr(workspaceId, prId),
      new SmartDiffService(this.container).getForPull(workspaceId, prId),
      this.repo.getPrFiles(prId),
    ]);
    const { pr_id: _pr_id, ...intentValue } = intent;

    // 2. Build the changed-file set (empty diff → empty set → all refs drop
    //    later in validation, per AC).
    const changedFiles = new Set(files.map((f) => f.path));

    // 3. Best-effort linked issue resolution — absent is not an error
    //    (AC-2 edge case), just build without it.
    const issue = await this.resolveLinkedIssue(pull, logger);

    // 4. Classify the Brief — one structured LLM call. Failure/invalid
    //    schema propagates as BriefClassificationError; cache is NOT
    //    written (AC-18, fail-closed).
    const { brief } = await classifyBrief({
      prTitle: pull.title,
      prBody: pull.body,
      intent: intentValue,
      blastSummary: renderBlastSummary(blast),
      smartDiff,
      issue,
      container: this.container,
      workspaceId,
      logger,
    });

    // 5. Validate + drop dangling refs against the changed-file set,
    //    logging every drop (AC-8).
    const { kept: risks, dropped: droppedRisks } = validateRisks(brief.risks, changedFiles);
    const { kept: reviewFocus, dropped: droppedFocus } = validateReviewFocus(
      brief.review_focus,
      changedFiles,
    );
    if (droppedRisks.length > 0 || droppedFocus.length > 0) {
      logger?.info(
        {
          prId,
          droppedRiskCount: droppedRisks.length,
          droppedReviewFocusCount: droppedFocus.length,
          droppedRiskRefs: droppedRisks.flatMap((r) => r.file_refs),
          droppedReviewFocusRefs: droppedFocus.map((f) => f.file_ref),
        },
        'brief: dropped risk/review_focus entries with no valid file refs',
      );
    }
    // Fallback: some models reliably fill `risks` but skip `review_focus`
    // even when explicitly instructed — derive a starting point straight
    // from the (already-validated) risks rather than leaving reviewers with
    // nothing to look at (see helpers.ts doc comment).
    const finalReviewFocus = reviewFocus.length > 0 ? reviewFocus : deriveReviewFocusFromRisks(risks);
    const validatedBrief = { ...brief, risks, review_focus: finalReviewFocus };

    // 6. Per-file (core role only) summaries — a second, independent LLM
    //    call. Fail-soft: keep the Brief, core_summaries = {} on failure
    //    (AC-17).
    const coreFiles = smartDiff.groups
      .filter((g) => g.role === 'core')
      .flatMap((g) => g.files);

    let coreSummaries: Record<string, string> = {};
    try {
      const { summaries } = await classifyCoreFileSummaries({
        coreFiles,
        container: this.container,
        workspaceId,
        logger,
      });
      coreSummaries = summaries;
    } catch (err) {
      if (err instanceof CoreFileSummaryError) {
        logger?.info(
          { prId, cause: err.message },
          'brief: core-file summaries failed — continuing with Brief only',
        );
      } else {
        throw err;
      }
    }

    // 7. Persist + return.
    const response: PrBriefResponse = {
      brief: validatedBrief,
      core_summaries: coreSummaries,
      head_sha: pull.headSha,
      generated: true,
    };

    await this.briefRepo.upsert(prId, pull.headSha, response);
    return response;
  }

  /**
   * Best-effort linked-issue resolution: parses the first `github` reference
   * out of the PR body and fetches it (issue, falling back to PR) via the
   * injected GitHub client. Missing PAT, no reference, or a fetch failure
   * all resolve to `null` — never an error (AC-2 edge case: build the brief
   * without the issue rather than failing).
   */
  private async resolveLinkedIssue(
    pull: PullRow,
    logger?: Logger,
  ): Promise<{ title: string; body: string | null } | null> {
    const repoRow = await this.repo.getRepo(pull.repoId);
    if (!repoRow) return null;

    const github = await this.container.github().catch(() => null);
    if (!github) return null;

    const repoRef = { owner: repoRow.owner, name: repoRow.name };
    const parsedRefs = parseReferences(pull.body, repoRef);
    const firstGithubRef = parsedRefs.find((r) => r.kind === 'github');
    if (firstGithubRef?.issueNumber == null) return null;

    const n = firstGithubRef.issueNumber;
    const targetRef =
      firstGithubRef.targetOwner && firstGithubRef.targetRepo
        ? { owner: firstGithubRef.targetOwner, name: firstGithubRef.targetRepo }
        : repoRef;

    try {
      const fetched = await github.getIssue(targetRef, n);
      return { title: fetched.title, body: fetched.body ?? null };
    } catch {
      try {
        const pr = await github.getPullRequest(targetRef, n);
        return { title: pr.title, body: pr.body ?? null };
      } catch (err) {
        logger?.info(
          { prId: pull.id, cause: err instanceof Error ? err.message : String(err) },
          'brief: linked issue resolution failed — continuing without it',
        );
        return null;
      }
    }
  }
}
