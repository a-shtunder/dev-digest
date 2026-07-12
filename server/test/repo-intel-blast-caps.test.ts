import { describe, it, expect } from 'vitest';
import { RepoIntelService } from '../src/modules/repo-intel/service.js';
import type { IndexState } from '../src/modules/repo-intel/types.js';
import type { FullSymbolRow, ResolvedCallerRow, IndexerEdgeRow, IndexerFileFactsRow } from '../src/modules/repo-intel/repository.js';

/**
 * T3 bugfix regression — `tryPersistentBlast` (service.ts):
 *
 * 1. `MAX_CALLERS_PER_SYMBOL` must be applied PER symbol (bucketed by
 *    `toSymbol`), not as a single slice over the whole flat rank-sorted
 *    array — a high-volume symbol must not starve a low-volume one.
 * 2. A "caller" row whose `fromPath` is the same file that declares the
 *    symbol is a self-reference, not a real caller, and must be excluded
 *    (mirrors the degraded/ripgrep sibling path's existing guard).
 * 3. Endpoint reachability now walks 2 hops over `getEdges()` (reverse
 *    adjacency), so an endpoint file that only imports a direct caller file
 *    (rather than calling the changed symbol itself) still surfaces in
 *    `impactedEndpoints`.
 *
 * Hermetic: no Postgres. `RepoIntelRepository` is replaced with a fake object
 * implementing just the methods `tryPersistentBlast` calls, following the
 * same patching pattern as `repo-intel-facade-degraded.test.ts`.
 */

const FULL_STATE: IndexState = {
  repoId: 'r1',
  status: 'full',
  filesIndexed: 10,
  filesSkipped: 0,
  durationMs: 0,
  lastIndexedSha: 'abc',
  indexerVersion: 1,
  updatedAt: new Date(0),
};

function buildService(opts: {
  declRows: FullSymbolRow[];
  resolvedCallers: ResolvedCallerRow[];
  edges?: IndexerEdgeRow[];
  fileFacts?: (files: string[]) => IndexerFileFactsRow[];
}): RepoIntelService {
  const container = {
    config: { repoIntelEnabled: true },
    db: {} as never,
  } as never;
  const svc = new RepoIntelService(container);
  (svc as unknown as { repo: Record<string, unknown> }).repo = {
    tryGetIndexState: async () => FULL_STATE,
    getSymbolRows: async (_repoId: string, paths: string[]) =>
      opts.declRows.filter((r) => paths.includes(r.path)),
    getResolvedCallers: async () => opts.resolvedCallers,
    getEdges: async () => opts.edges ?? [],
    getFileFacts: async (_repoId: string, files: string[]) => opts.fileFacts?.(files) ?? [],
  };
  return svc;
}

describe('tryPersistentBlast — per-symbol caller cap (via getBlastRadius)', () => {
  it('caps EACH symbol bucket independently — a high-volume symbol does not starve a low-volume one', async () => {
    const declRows: FullSymbolRow[] = [
      { path: 'decl.ts', name: 'A', kind: 'function', line: 1, endLine: 2, exported: true, signature: null },
      { path: 'decl.ts', name: 'B', kind: 'function', line: 5, endLine: 6, exported: true, signature: null },
    ];
    const aCallers: ResolvedCallerRow[] = Array.from({ length: 25 }, (_, i) => ({
      fromPath: `callerA${i}.ts`,
      toSymbol: 'A',
      declFile: 'decl.ts',
      line: 1,
      rank: i,
    }));
    const bCallers: ResolvedCallerRow[] = [
      { fromPath: 'callerB0.ts', toSymbol: 'B', declFile: 'decl.ts', line: 1, rank: 1 },
      { fromPath: 'callerB1.ts', toSymbol: 'B', declFile: 'decl.ts', line: 1, rank: 2 },
    ];

    const svc = buildService({ declRows, resolvedCallers: [...aCallers, ...bCallers] });
    const result = await svc.getBlastRadius('r1', ['decl.ts']);

    const aResult = result.callers.filter((c) => c.viaSymbol === 'A');
    const bResult = result.callers.filter((c) => c.viaSymbol === 'B');
    expect(aResult).toHaveLength(20); // capped from 25
    expect(bResult).toHaveLength(2); // NOT starved by A's 25 callers
  });
});

describe('tryPersistentBlast — decl-file exclusion (via getBlastRadius)', () => {
  it('excludes a caller row whose fromPath is the symbol\'s own declaring file', async () => {
    const declRows: FullSymbolRow[] = [
      { path: 'foo.ts', name: 'helper', kind: 'function', line: 1, endLine: 2, exported: true, signature: null },
    ];
    const resolvedCallers: ResolvedCallerRow[] = [
      { fromPath: 'foo.ts', toSymbol: 'helper', declFile: 'foo.ts', line: 10, rank: 5 }, // self-reference — must be excluded
      { fromPath: 'bar.ts', toSymbol: 'helper', declFile: 'foo.ts', line: 3, rank: 2 }, // real caller — must survive
    ];

    const svc = buildService({ declRows, resolvedCallers });
    const result = await svc.getBlastRadius('r1', ['foo.ts']);

    expect(result.callers).toHaveLength(1);
    expect(result.callers[0]?.file).toBe('bar.ts');
  });
});

describe('tryPersistentBlast — same-named symbols in different changed files', () => {
  it('does not merge or cross-attribute callers when two changed files declare a same-named symbol', async () => {
    const declRows: FullSymbolRow[] = [
      { path: 'hot.ts', name: 'handler', kind: 'function', line: 1, endLine: 2, exported: true, signature: null },
      { path: 'cold.ts', name: 'handler', kind: 'function', line: 1, endLine: 2, exported: true, signature: null },
    ];
    const resolvedCallers: ResolvedCallerRow[] = [
      // 25 real callers of hot.ts's `handler` — must NOT starve cold.ts's callers.
      ...Array.from({ length: 25 }, (_, i) => ({
        fromPath: `hotCaller${i}.ts`,
        toSymbol: 'handler',
        declFile: 'hot.ts',
        line: 1,
        rank: i,
      })),
      // A self-reference inside cold.ts's OWN file — must be excluded even
      // though `hot.ts` also declares a symbol named `handler`.
      { fromPath: 'cold.ts', toSymbol: 'handler', declFile: 'cold.ts', line: 9, rank: 99 },
      // A real external caller of cold.ts's `handler` — must survive.
      { fromPath: 'coldCaller.ts', toSymbol: 'handler', declFile: 'cold.ts', line: 3, rank: 1 },
    ];

    const svc = buildService({ declRows, resolvedCallers });
    const result = await svc.getBlastRadius('r1', ['hot.ts', 'cold.ts']);

    const hotCallers = result.callers.filter((c) => c.viaFile === 'hot.ts');
    const coldCallers = result.callers.filter((c) => c.viaFile === 'cold.ts');

    expect(hotCallers).toHaveLength(20); // capped independently of cold.ts
    expect(coldCallers).toHaveLength(1); // only the real external caller — self-ref excluded, NOT starved by hot.ts
    expect(coldCallers[0]?.file).toBe('coldCaller.ts');
  });
});

describe('tryPersistentBlast — 2-hop endpoint reachability (via getBlastRadius)', () => {
  it('surfaces an endpoint only reachable via a second import hop (route.ts imports mid.ts)', async () => {
    const declRows: FullSymbolRow[] = [
      { path: 'sym.ts', name: 'doStuff', kind: 'function', line: 1, endLine: 2, exported: true, signature: null },
    ];
    const resolvedCallers: ResolvedCallerRow[] = [
      { fromPath: 'mid.ts', toSymbol: 'doStuff', declFile: 'sym.ts', line: 4, rank: 3 },
    ];
    const edges: IndexerEdgeRow[] = [{ fromFile: 'route.ts', toFile: 'mid.ts' }];

    const svc = buildService({
      declRows,
      resolvedCallers,
      edges,
      fileFacts: (files) =>
        files.includes('route.ts')
          ? [{ filePath: 'route.ts', endpoints: ['GET /api/x'], crons: [] }]
          : [],
    });
    const result = await svc.getBlastRadius('r1', ['sym.ts']);

    // route.ts never directly called `doStuff` — it's only reachable because
    // it imports mid.ts, which is a direct caller. Proves the BFS extension.
    expect(result.impactedEndpoints).toContain('GET /api/x');
  });
});
