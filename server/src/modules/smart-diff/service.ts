/**
 * service.ts — SmartDiffService: deterministically recomposes already-stored
 * data (PR files + last review's findings + per-file summaries) into a
 * SmartDiff.
 *
 * Onion layer: application layer — orchestrates ReviewRepository reads only.
 * CRITICAL INVARIANT: this module makes ZERO LLM calls. Never reference
 * `container.llm` here (mirrors intent/service.ts structure, minus the LLM step).
 */
import type { Container } from '../../platform/container.js';
import type { SmartDiff } from '@devdigest/shared';
import { NotFoundError } from '../../platform/errors.js';
import { ReviewRepository } from '../reviews/repository.js';
import { buildSmartDiff, type SmartDiffFileInput, type SmartDiffFindingInput } from './classifier.js';

export class SmartDiffService {
  private repo: ReviewRepository;

  constructor(private container: Container) {
    this.repo = new ReviewRepository(container.db);
  }

  async getForPull(workspaceId: string, prId: string): Promise<SmartDiff> {
    const pull = await this.repo.getPull(workspaceId, prId);
    if (!pull) throw new NotFoundError(`Pull request not found: ${prId}`);

    const prFiles = await this.repo.getPrFiles(prId);
    const files: SmartDiffFileInput[] = prFiles.map((f) => ({
      path: f.path,
      additions: f.additions,
      deletions: f.deletions,
    }));

    const reviews = await this.repo.reviewsForPull(prId);
    const latestReview = reviews.find((r) => r.review.kind === 'review');

    // Per-file summaries are not yet persisted (no `file_summaries` column in
    // this PR — see reviewer-core's `outcome.fileSummaries`, still in-memory
    // only). `pseudocode_summary` is therefore always null until a follow-up
    // PR adds the migration + persistence.
    const findings: SmartDiffFindingInput[] = latestReview
      ? latestReview.findings.map((f) => ({ file: f.file, start_line: f.startLine }))
      : [];
    const summaries = new Map<string, string>();

    return buildSmartDiff(files, findings, summaries);
  }
}
