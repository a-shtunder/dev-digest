/**
 * service.ts — BlastService: thin orchestration for the Blast Radius feature.
 *
 * Onion layer: application — no SQL, no adapter instantiation. Resolves a PR
 * to its repo + changed files (via `container.reviewRepo`, the shared
 * cross-cutting repository already exposed on the container) then delegates
 * the actual blast computation entirely to `container.repoIntel.getBlastRadius`,
 * which never throws (see repo-intel/types.ts degraded contract) — so the
 * result is returned as-is with no branching here.
 *
 * No `repository.ts` in this module: the only DB access needed (PR → repoId +
 * changed files) is already a public getter on Container; adding a second
 * repository instance over the same tables here would be a pass-through.
 */
import type { Container } from '../../platform/container.js';
import { NotFoundError } from '../../platform/errors.js';
import type { BlastRadiusResult } from '@devdigest/shared';

export class BlastService {
  constructor(private container: Container) {}

  async getForPr(workspaceId: string, prId: string): Promise<BlastRadiusResult> {
    const pull = await this.container.reviewRepo.getPull(workspaceId, prId);
    if (!pull) throw new NotFoundError(`Pull request not found: ${prId}`);

    const files = await this.container.reviewRepo.getPrFiles(prId);
    const changedFiles = files.map((f) => f.path);

    return this.container.repoIntel.getBlastRadius(pull.repoId, changedFiles);
  }
}
