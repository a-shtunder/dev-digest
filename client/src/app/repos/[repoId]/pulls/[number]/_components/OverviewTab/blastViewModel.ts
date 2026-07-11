/* blastViewModel.ts — pure transforms for the Blast Radius card. No React. */
import type { BlastChangedSymbol, BlastCallerRow, BlastFileFacts } from "@devdigest/shared";

export interface BlastSymbolGroup {
  symbol: BlastChangedSymbol;
  callers: BlastCallerRow[];
  /** Endpoints/crons reachable through THIS symbol's own callers — a union of
      `factsByFile` over the group's caller files, so each symbol's expanded
      row shows only what it's actually responsible for (matches the design:
      badges live under the symbol, not in one flat pile for the whole PR).
      Endpoints reachable only via the global 2-hop BFS (not attributable to
      any single symbol's direct callers) are excluded here — they still
      count toward the card's top-level stat totals. */
  endpoints: string[];
  crons: string[];
}

/** Group flat caller rows under the changed symbol they call into. Matches on
    (viaSymbol AND viaFile) — matching on name alone would silently merge/
    misattribute callers whenever two changed files declare a same-named
    symbol (e.g. two files each exporting `handler`). Returns all groups,
    including ones with zero callers — callers decide whether to filter
    those out for display (see BlastRadiusCard). */
export function groupCallersBySymbol(
  changedSymbols: BlastChangedSymbol[],
  callers: BlastCallerRow[],
  factsByFile?: Record<string, BlastFileFacts>,
): BlastSymbolGroup[] {
  return changedSymbols.map((symbol) => {
    const groupCallers = callers.filter(
      (c) => c.viaSymbol === symbol.name && c.viaFile === symbol.file,
    );
    const endpointSet = new Set<string>();
    const cronSet = new Set<string>();
    if (factsByFile) {
      for (const caller of groupCallers) {
        const facts = factsByFile[caller.file];
        if (!facts) continue;
        for (const e of facts.endpoints) endpointSet.add(e);
        for (const c of facts.crons) cronSet.add(c);
      }
    }
    return {
      symbol,
      callers: groupCallers,
      endpoints: [...endpointSet],
      crons: [...cronSet],
    };
  });
}
