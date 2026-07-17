import { describe, it, expect } from 'vitest';
import type { Finding, ExpectedFinding } from '@devdigest/shared';
import { matches, scoreCase, aggregate } from './scoring.js';

function makeFinding(overrides: Partial<Finding> = {}): Finding {
  return {
    id: overrides.id ?? 'f1',
    severity: overrides.severity ?? 'WARNING',
    category: overrides.category ?? 'bug',
    title: overrides.title ?? 'Some finding',
    file: overrides.file ?? 'src/a.ts',
    start_line: overrides.start_line ?? 10,
    end_line: overrides.end_line ?? 10,
    rationale: overrides.rationale ?? 'because',
    suggestion: overrides.suggestion ?? null,
    confidence: overrides.confidence ?? 0.9,
    kind: overrides.kind ?? 'finding',
  };
}

function makeExpected(overrides: Partial<ExpectedFinding> = {}): ExpectedFinding {
  return {
    severity: overrides.severity ?? 'WARNING',
    category: overrides.category ?? 'bug',
    title: overrides.title ?? 'Some finding',
    file: overrides.file ?? 'src/a.ts',
    start_line: overrides.start_line ?? 10,
    end_line: overrides.end_line,
  };
}

describe('matches', () => {
  it('matches same file with overlapping line ranges', () => {
    const produced = makeFinding({ file: 'src/a.ts', start_line: 10, end_line: 12 });
    const expected = makeExpected({ file: 'src/a.ts', start_line: 11, end_line: 15 });
    expect(matches(produced, expected)).toBe(true);
  });

  it('does not match a different file', () => {
    const produced = makeFinding({ file: 'src/a.ts', start_line: 10, end_line: 12 });
    const expected = makeExpected({ file: 'src/b.ts', start_line: 10, end_line: 12 });
    expect(matches(produced, expected)).toBe(false);
  });

  it('does not match non-overlapping ranges on the same file', () => {
    const produced = makeFinding({ file: 'src/a.ts', start_line: 10, end_line: 12 });
    const expected = makeExpected({ file: 'src/a.ts', start_line: 13, end_line: 20 });
    expect(matches(produced, expected)).toBe(false);
  });

  it('defaults expected.end_line to start_line when nullish', () => {
    const produced = makeFinding({ file: 'src/a.ts', start_line: 10, end_line: 10 });
    const expected = makeExpected({ file: 'src/a.ts', start_line: 10, end_line: undefined });
    expect(matches(produced, expected)).toBe(true);

    const producedNoOverlap = makeFinding({ file: 'src/a.ts', start_line: 11, end_line: 11 });
    expect(matches(producedNoOverlap, expected)).toBe(false);
  });

  it('overlap is inclusive on both ends', () => {
    const produced = makeFinding({ file: 'src/a.ts', start_line: 5, end_line: 10 });
    const expectedTouchingStart = makeExpected({ file: 'src/a.ts', start_line: 1, end_line: 5 });
    const expectedTouchingEnd = makeExpected({ file: 'src/a.ts', start_line: 10, end_line: 15 });
    expect(matches(produced, expectedTouchingStart)).toBe(true);
    expect(matches(produced, expectedTouchingEnd)).toBe(true);
  });
});

describe('scoreCase', () => {
  it('expected 1, got 1 matching -> pass with recall/precision 1', () => {
    const expected = [makeExpected({ file: 'src/a.ts', start_line: 10, end_line: 10 })];
    const produced = [makeFinding({ file: 'src/a.ts', start_line: 10, end_line: 10 })];

    const result = scoreCase({ produced, expected, kept: 1, dropped: 0 });

    expect(result).toEqual({
      recall: 1,
      precision: 1,
      citation_accuracy: 1,
      pass: true,
    });
  });

  it('expected 1, got 0 -> fail with recall 0', () => {
    const expected = [makeExpected({ file: 'src/a.ts', start_line: 10, end_line: 10 })];
    const produced: Finding[] = [];

    const result = scoreCase({ produced, expected, kept: 0, dropped: 0 });

    expect(result.recall).toBe(0);
    expect(result.precision).toBe(1); // empty produced -> precision 1
    expect(result.pass).toBe(false);
  });

  it('expected 0, got 0 -> pass with recall/precision 1', () => {
    const result = scoreCase({ produced: [], expected: [], kept: 0, dropped: 0 });

    expect(result).toEqual({
      recall: 1,
      precision: 1,
      citation_accuracy: 1,
      pass: true,
    });
  });

  it('produced finding on empty expected -> false positive, fail', () => {
    const produced = [makeFinding({ file: 'src/a.ts', start_line: 10, end_line: 10 })];

    const result = scoreCase({ produced, expected: [], kept: 1, dropped: 0 });

    expect(result.recall).toBe(1); // empty expected -> recall 1
    expect(result.precision).toBe(0); // one unmatched produced -> FP
    expect(result.pass).toBe(false);
  });

  it('grounding all-dropped -> citation_accuracy 0', () => {
    const expected = [makeExpected({ file: 'src/a.ts', start_line: 10, end_line: 10 })];
    const produced = [makeFinding({ file: 'src/a.ts', start_line: 10, end_line: 10 })];

    const result = scoreCase({ produced, expected, kept: 0, dropped: 3 });

    expect(result.citation_accuracy).toBe(0);
  });

  it('kept + dropped = 0 -> citation_accuracy 1', () => {
    const expected = [makeExpected({ file: 'src/a.ts', start_line: 10, end_line: 10 })];
    const produced = [makeFinding({ file: 'src/a.ts', start_line: 10, end_line: 10 })];

    const result = scoreCase({ produced, expected, kept: 0, dropped: 0 });

    expect(result.citation_accuracy).toBe(1);
  });

  it('partial match: one expected matched, one unmatched produced -> fail', () => {
    const expected = [
      makeExpected({ file: 'src/a.ts', start_line: 10, end_line: 10 }),
      makeExpected({ file: 'src/a.ts', start_line: 30, end_line: 30 }),
    ];
    const produced = [
      makeFinding({ file: 'src/a.ts', start_line: 10, end_line: 10 }),
      makeFinding({ file: 'src/a.ts', start_line: 50, end_line: 50 }), // unmatched -> FP
    ];

    const result = scoreCase({ produced, expected, kept: 2, dropped: 0 });

    expect(result.recall).toBe(0.5);
    expect(result.precision).toBe(0.5);
    expect(result.pass).toBe(false);
  });
});

describe('aggregate', () => {
  it('micro-averages pooled counts, which differs from a per-case average', () => {
    // Case 1: expected 1, matched 1 -> per-case recall 1
    const case1 = {
      expected: [makeExpected({ file: 'src/a.ts', start_line: 10, end_line: 10 })],
      produced: [makeFinding({ file: 'src/a.ts', start_line: 10, end_line: 10 })],
      kept: 1,
      dropped: 0,
    };
    // Case 2: expected 3, matched 0 -> per-case recall 0
    const case2 = {
      expected: [
        makeExpected({ file: 'src/b.ts', start_line: 1, end_line: 1 }),
        makeExpected({ file: 'src/b.ts', start_line: 2, end_line: 2 }),
        makeExpected({ file: 'src/b.ts', start_line: 3, end_line: 3 }),
      ],
      produced: [] as Finding[],
      kept: 0,
      dropped: 0,
    };

    // Per-case average recall would be (1 + 0) / 2 = 0.5.
    // Micro-averaged (pooled): matched 1 of total 4 expected -> 0.25.
    const result = aggregate([case1, case2]);

    expect(result.recall).toBeCloseTo(0.25);
    expect(result.recall).not.toBeCloseTo(0.5);
    expect(result.traces_total).toBe(2);
    expect(result.traces_passed).toBe(1); // only case1 passes
  });

  it('pools precision and citation_accuracy counts across cases', () => {
    const case1 = {
      expected: [makeExpected({ file: 'src/a.ts', start_line: 10, end_line: 10 })],
      produced: [makeFinding({ file: 'src/a.ts', start_line: 10, end_line: 10 })],
      kept: 1,
      dropped: 0,
    };
    const case2 = {
      expected: [] as ExpectedFinding[],
      produced: [makeFinding({ file: 'src/b.ts', start_line: 5, end_line: 5 })], // FP
      kept: 0,
      dropped: 1,
    };

    const result = aggregate([case1, case2]);

    // produced total 2, matched 1 -> precision 0.5
    expect(result.precision).toBe(0.5);
    // kept 1, dropped 1 -> citation_accuracy 0.5
    expect(result.citation_accuracy).toBe(0.5);
    expect(result.traces_passed).toBe(1); // case2 fails (FP)
    expect(result.traces_total).toBe(2);
  });
});
