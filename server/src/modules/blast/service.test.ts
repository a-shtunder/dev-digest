import { describe, it, expect, vi } from 'vitest';
import { BlastService } from './service.js';
import { NotFoundError } from '../../platform/errors.js';
import type { BlastRadiusResult } from '@devdigest/shared';
import type { Container } from '../../platform/container.js';
import type { PullRow } from '../reviews/repository.js';

/**
 * Hermetic unit tests — a minimal fake Container shape, stubbing only
 * `.reviewRepo` and `.repoIntel` (the two dependencies BlastService actually
 * calls). Mirrors the fake-container pattern used in
 * `test/repo-intel-facade-degraded.test.ts`.
 */
function buildContainer(opts: {
  pull?: Partial<PullRow> | undefined;
  files?: { path: string }[];
  blast?: BlastRadiusResult;
}) {
  const getPull = vi.fn().mockResolvedValue(opts.pull as PullRow | undefined);
  const getPrFiles = vi.fn().mockResolvedValue(opts.files ?? []);
  const getBlastRadius = vi.fn().mockResolvedValue(
    opts.blast ?? {
      changedSymbols: [],
      callers: [],
      impactedEndpoints: [],
    },
  );

  const container = {
    reviewRepo: { getPull, getPrFiles },
    repoIntel: { getBlastRadius },
  } as unknown as Container;

  return { container, getPull, getPrFiles, getBlastRadius };
}

describe('BlastService.getForPr', () => {
  it('normal case: resolves pull → files → delegates to repoIntel.getBlastRadius unchanged', async () => {
    const sample: BlastRadiusResult = {
      changedSymbols: [{ file: 'a.ts', name: 'foo', kind: 'function' }],
      callers: [{ file: 'b.ts', symbol: 'bar', viaSymbol: 'foo', viaFile: 'a.ts', line: 10, rank: 5 }],
      impactedEndpoints: ['GET /foo'],
    };
    const { container, getBlastRadius } = buildContainer({
      pull: { id: 'pr-1', repoId: 'repo-1' },
      files: [{ path: 'a.ts' }, { path: 'b.ts' }],
      blast: sample,
    });

    const service = new BlastService(container);
    const result = await service.getForPr('ws-1', 'pr-1');

    expect(result).toEqual(sample);
    expect(getBlastRadius).toHaveBeenCalledWith('repo-1', ['a.ts', 'b.ts']);
  });

  it('PR not found: throws NotFoundError and never calls getPrFiles/getBlastRadius', async () => {
    const { container, getPrFiles, getBlastRadius } = buildContainer({ pull: undefined });

    const service = new BlastService(container);

    await expect(service.getForPr('ws-1', 'missing-pr')).rejects.toThrow(NotFoundError);
    expect(getPrFiles).not.toHaveBeenCalled();
    expect(getBlastRadius).not.toHaveBeenCalled();
  });

  it('degraded passthrough: returns the degraded flag/reason completely unchanged', async () => {
    const degraded: BlastRadiusResult = {
      changedSymbols: [],
      callers: [],
      impactedEndpoints: [],
      degraded: true,
      reason: 'index_partial',
    };
    const { container } = buildContainer({
      pull: { id: 'pr-1', repoId: 'repo-1' },
      files: [{ path: 'a.ts' }],
      blast: degraded,
    });

    const service = new BlastService(container);
    const result = await service.getForPr('ws-1', 'pr-1');

    expect(result).toEqual(degraded);
    expect(result.degraded).toBe(true);
    expect(result.reason).toBe('index_partial');
  });

  it('empty changed files: getBlastRadius is called with an empty array', async () => {
    const { container, getBlastRadius } = buildContainer({
      pull: { id: 'pr-1', repoId: 'repo-1' },
      files: [],
    });

    const service = new BlastService(container);
    await service.getForPr('ws-1', 'pr-1');

    expect(getBlastRadius).toHaveBeenCalledWith('repo-1', []);
  });
});
