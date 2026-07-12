import { describe, expect, it } from 'vitest';
import { resolveSpecPaths } from './injection.js';

describe('resolveSpecPaths', () => {
  it('orders agent paths first, then loaded skills in load order, deduping first-wins', () => {
    const result = resolveSpecPaths({
      agentPaths: ['a', 'b'],
      loadedSkills: [{ paths: ['b', 'c'] }, { paths: ['a', 'd'] }],
    });
    expect(result).toEqual(['a', 'b', 'c', 'd']);
  });

  it('returns an empty array for empty inputs', () => {
    expect(resolveSpecPaths({ agentPaths: [], loadedSkills: [] })).toEqual([]);
  });
});
