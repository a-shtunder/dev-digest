import { describe, it, expect } from 'vitest';
import {
  parseFileRef,
  validateAndDedupeRefs,
  validateRisks,
  validateReviewFocus,
  deriveReviewFocusFromRisks,
} from './helpers.js';
import type { Risk, ReviewFocusItem } from '@devdigest/shared';

function risk(overrides: Partial<Risk>): Risk {
  return {
    kind: 'security',
    title: 'Sample risk',
    explanation: 'explanation',
    severity: 'medium',
    file_refs: [],
    ...overrides,
  };
}

describe('parseFileRef', () => {
  it('parses single-line and range locators, rejects malformed strings', () => {
    expect(parseFileRef('src/a.ts:10')).toEqual({ file: 'src/a.ts', startLine: 10 });
    expect(parseFileRef('src/a.ts:10-20')).toEqual({ file: 'src/a.ts', startLine: 10, endLine: 20 });
    expect(parseFileRef('no-line-number')).toBeNull();
    expect(parseFileRef('src/a.ts:')).toBeNull();
  });
});

describe('validateAndDedupeRefs', () => {
  const changedFiles = new Set(['src/a.ts', 'src/b.ts']);

  it('drops invalid refs: unparseable and unknown-file', () => {
    const { kept, dropped } = validateAndDedupeRefs(['src/a.ts:1', 'not-a-ref', 'src/unknown.ts:5'], changedFiles);
    expect(kept).toEqual(['src/a.ts:1']);
    expect(dropped).toEqual(['not-a-ref', 'src/unknown.ts:5']);
  });

  it('keeps a valid file with an out-of-range line number (AC-6: not validated)', () => {
    const { kept, dropped } = validateAndDedupeRefs(['src/a.ts:99999'], changedFiles);
    expect(kept).toEqual(['src/a.ts:99999']);
    expect(dropped).toEqual([]);
  });

  it('dedupes deterministically by path+range, keeping first occurrence', () => {
    const { kept, dropped } = validateAndDedupeRefs(
      ['src/a.ts:10-20', 'src/a.ts:10-20', 'src/b.ts:5', 'src/a.ts:10-20'],
      changedFiles,
    );
    expect(kept).toEqual(['src/a.ts:10-20', 'src/b.ts:5']);
    expect(dropped).toEqual(['src/a.ts:10-20', 'src/a.ts:10-20']);
  });

  it('empty changed-file set drops all refs', () => {
    const { kept, dropped } = validateAndDedupeRefs(['src/a.ts:1', 'src/b.ts:2'], new Set());
    expect(kept).toEqual([]);
    expect(dropped).toEqual(['src/a.ts:1', 'src/b.ts:2']);
  });
});

describe('validateRisks', () => {
  const changedFiles = new Set(['src/a.ts', 'src/b.ts']);

  it('drops a risk left with zero valid refs after validation (AC-7)', () => {
    const risks: Risk[] = [
      risk({ title: 'valid', file_refs: ['src/a.ts:1'] }),
      risk({ title: 'invalid', file_refs: ['src/unknown.ts:1', 'garbage'] }),
    ];
    const { kept, dropped } = validateRisks(risks, changedFiles);
    expect(kept.map((r) => r.title)).toEqual(['valid']);
    expect(dropped.map((r) => r.title)).toEqual(['invalid']);
  });

  it('keeps a risk with mixed valid/invalid refs, dropping only the invalid ones', () => {
    const risks: Risk[] = [risk({ title: 'mixed', file_refs: ['src/a.ts:1', 'src/unknown.ts:2', 'src/a.ts:1'] })];
    const { kept, dropped } = validateRisks(risks, changedFiles);
    expect(kept).toEqual([risk({ title: 'mixed', file_refs: ['src/a.ts:1'] })]);
    expect(dropped).toEqual([]);
  });

  it('empty changed-file set drops every risk (all refs invalid)', () => {
    const risks: Risk[] = [risk({ title: 'a', file_refs: ['src/a.ts:1'] }), risk({ title: 'b', file_refs: ['src/b.ts:1'] })];
    const { kept, dropped } = validateRisks(risks, new Set());
    expect(kept).toEqual([]);
    expect(dropped.map((r) => r.title)).toEqual(['a', 'b']);
  });
});

describe('validateReviewFocus', () => {
  const changedFiles = new Set(['src/a.ts']);

  it('drops a focus item whose ref is invalid', () => {
    const items: ReviewFocusItem[] = [
      { label: 'valid', file_ref: 'src/a.ts:1', reason: 'r1' },
      { label: 'invalid', file_ref: 'src/unknown.ts:1', reason: 'r2' },
      { label: 'malformed', file_ref: 'garbage', reason: 'r3' },
    ];
    const { kept, dropped } = validateReviewFocus(items, changedFiles);
    expect(kept.map((i) => i.label)).toEqual(['valid']);
    expect(dropped.map((i) => i.label)).toEqual(['invalid', 'malformed']);
  });
});

describe('deriveReviewFocusFromRisks', () => {
  it('derives one item per distinct risky file, from the first ref only', () => {
    const risks: Risk[] = [
      risk({ title: 'Risk A', explanation: 'exp A', file_refs: ['src/a.ts:1', 'src/a.ts:5'] }),
      risk({ title: 'Risk B', explanation: 'exp B', file_refs: ['src/b.ts:2'] }),
    ];
    const items = deriveReviewFocusFromRisks(risks);
    expect(items).toEqual([
      { label: 'Risk A', file_ref: 'src/a.ts:1', reason: 'exp A' },
      { label: 'Risk B', file_ref: 'src/b.ts:2', reason: 'exp B' },
    ]);
  });

  it('dedupes by file: a second risk on an already-seen file contributes nothing', () => {
    const risks: Risk[] = [
      risk({ title: 'First', file_refs: ['src/a.ts:1'] }),
      risk({ title: 'Second on same file', file_refs: ['src/a.ts:99'] }),
    ];
    const items = deriveReviewFocusFromRisks(risks);
    expect(items).toHaveLength(1);
    expect(items[0]!.label).toBe('First');
  });

  it('returns an empty array for an empty risks list', () => {
    expect(deriveReviewFocusFromRisks([])).toEqual([]);
  });

  it('skips a risk with no file_refs at all', () => {
    const risks: Risk[] = [risk({ title: 'No refs', file_refs: [] })];
    expect(deriveReviewFocusFromRisks(risks)).toEqual([]);
  });
});
