import type { Finding, ExpectedFinding } from '@devdigest/shared';

/**
 * Pure, zero-LLM scoring for eval cases (L06 A4).
 *
 * This module MUST NOT import anything Container/LLM/provider related — the
 * "zero LLM" guarantee for eval scoring is structural, not just behavioral.
 */

/**
 * True when a produced finding "matches" an expected finding: same `file`
 * AND their line ranges overlap (inclusive on both ends). `end_line` on
 * `ExpectedFinding` is nullish and defaults to its own `start_line`.
 */
export function matches(produced: Finding, expected: ExpectedFinding): boolean {
  if (produced.file !== expected.file) return false;

  const aStart = produced.start_line;
  const aEnd = produced.end_line;
  const bStart = expected.start_line;
  const bEnd = expected.end_line ?? expected.start_line;

  return aStart <= bEnd && bStart <= aEnd;
}

export interface ScoreCaseInput {
  produced: Finding[];
  expected: ExpectedFinding[];
  /** Grounding-kept count from the run outcome (`ReviewOutcome.review.findings`). */
  kept: number;
  /** Grounding-dropped count from the run outcome (`ReviewOutcome.dropped`). */
  dropped: number;
}

export interface ScoreCaseResult {
  recall: number;
  precision: number;
  citation_accuracy: number;
  pass: boolean;
}

/**
 * Score a single eval case against its produced findings.
 *
 * - recall: matched_expected / total_expected (empty expected -> 1)
 * - precision: matched_produced / total_produced (empty produced -> 1); any
 *   unmatched produced finding counts as a false positive, including every
 *   produced finding when `expected` is empty.
 * - citation_accuracy: kept / (kept + dropped) from the run outcome (no
 *   denominator -> 1). This is NOT re-derived from `matches()` — it comes
 *   straight from the grounding gate's kept/dropped counts.
 * - pass: every expected finding matched AND zero false positives.
 */
export function scoreCase({ produced, expected, kept, dropped }: ScoreCaseInput): ScoreCaseResult {
  // For each expected finding, is there at least one produced finding that matches it?
  const expectedMatched = expected.map((exp) => produced.some((p) => matches(p, exp)));
  const matchedExpectedCount = expectedMatched.filter(Boolean).length;

  // For each produced finding, is there at least one expected finding it matches?
  const producedMatched = produced.map((p) => expected.some((exp) => matches(p, exp)));
  const matchedProducedCount = producedMatched.filter(Boolean).length;
  const falsePositiveCount = produced.length - matchedProducedCount;

  const recall = expected.length === 0 ? 1 : matchedExpectedCount / expected.length;
  const precision = produced.length === 0 ? 1 : matchedProducedCount / produced.length;

  const citationDenominator = kept + dropped;
  const citation_accuracy = citationDenominator === 0 ? 1 : kept / citationDenominator;

  const allExpectedMatched = matchedExpectedCount === expected.length;
  const pass = allExpectedMatched && falsePositiveCount === 0;

  return { recall, precision, citation_accuracy, pass };
}

export interface AggregateCaseInput {
  produced: Finding[];
  expected: ExpectedFinding[];
  kept: number;
  dropped: number;
}

export interface AggregateResult {
  recall: number;
  precision: number;
  citation_accuracy: number;
  traces_passed: number;
  traces_total: number;
}

/**
 * Run-level aggregate across multiple cases, micro-averaged (pooled counts),
 * NOT a per-case average of `scoreCase` outputs.
 */
export function aggregate(cases: AggregateCaseInput[]): AggregateResult {
  let matchedExpectedTotal = 0;
  let expectedTotal = 0;
  let matchedProducedTotal = 0;
  let producedTotal = 0;
  let keptTotal = 0;
  let droppedTotal = 0;
  let tracesPassed = 0;

  for (const { produced, expected, kept, dropped } of cases) {
    const expectedMatched = expected.map((exp) => produced.some((p) => matches(p, exp)));
    const matchedExpectedCount = expectedMatched.filter(Boolean).length;

    const producedMatched = produced.map((p) => expected.some((exp) => matches(p, exp)));
    const matchedProducedCount = producedMatched.filter(Boolean).length;
    const falsePositiveCount = produced.length - matchedProducedCount;

    matchedExpectedTotal += matchedExpectedCount;
    expectedTotal += expected.length;
    matchedProducedTotal += matchedProducedCount;
    producedTotal += produced.length;
    keptTotal += kept;
    droppedTotal += dropped;

    const allExpectedMatched = matchedExpectedCount === expected.length;
    if (allExpectedMatched && falsePositiveCount === 0) tracesPassed += 1;
  }

  const recall = expectedTotal === 0 ? 1 : matchedExpectedTotal / expectedTotal;
  const precision = producedTotal === 0 ? 1 : matchedProducedTotal / producedTotal;
  const citationDenominator = keptTotal + droppedTotal;
  const citation_accuracy = citationDenominator === 0 ? 1 : keptTotal / citationDenominator;

  return {
    recall,
    precision,
    citation_accuracy,
    traces_passed: tracesPassed,
    traces_total: cases.length,
  };
}
