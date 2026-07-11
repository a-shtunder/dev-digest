import { describe, it, expect } from 'vitest';
import { classifyFile, buildSmartDiff } from './classifier.js';

describe('classifyFile', () => {
  it('lock files are ALWAYS boilerplate, regardless of nesting', () => {
    expect(classifyFile('pnpm-lock.yaml')).toBe('boilerplate');
    expect(classifyFile('a/b/package-lock.json')).toBe('boilerplate');
  });

  it('config-shaped and entrypoint files are wiring', () => {
    expect(classifyFile('foo.config.ts')).toBe('wiring');
    expect(classifyFile('index.ts')).toBe('wiring');
    expect(classifyFile('server.ts')).toBe('wiring');
  });

  it('type declarations, SVGs, and generated migrations are boilerplate', () => {
    expect(classifyFile('src/types/api.d.ts')).toBe('boilerplate');
    expect(classifyFile('client/public/logo.svg')).toBe('boilerplate');
    expect(classifyFile('src/db/migrations/0011_new_table.sql')).toBe('boilerplate');
  });

  it('CI/CD and container config are wiring, not core', () => {
    expect(classifyFile('.github/workflows/client.yml')).toBe('wiring');
    expect(classifyFile('.github/workflows/e2e-web.yml')).toBe('wiring');
    expect(classifyFile('.github/dependabot.yml')).toBe('wiring');
    expect(classifyFile('Dockerfile')).toBe('wiring');
    expect(classifyFile('docker-compose.yml')).toBe('wiring');
  });

  it('everything else is core', () => {
    expect(classifyFile('src/middleware/ratelimit.ts')).toBe('core');
  });
});

describe('buildSmartDiff', () => {
  it('draws finding_lines from the correct file only, sorted and unique', () => {
    const files = [
      { path: 'src/a.ts', additions: 5, deletions: 1 },
      { path: 'src/b.ts', additions: 2, deletions: 0 },
    ];
    const findings = [
      { file: 'src/a.ts', start_line: 20 },
      { file: 'src/a.ts', start_line: 5 },
      { file: 'src/a.ts', start_line: 20 }, // duplicate
      { file: 'src/b.ts', start_line: 99 },
    ];
    const result = buildSmartDiff(files, findings, new Map());

    const coreGroup = result.groups.find((g) => g.role === 'core')!;
    const fileA = coreGroup.files.find((f) => f.path === 'src/a.ts')!;
    const fileB = coreGroup.files.find((f) => f.path === 'src/b.ts')!;
    expect(fileA.finding_lines).toEqual([5, 20]);
    expect(fileB.finding_lines).toEqual([99]);
  });

  it('pseudocode_summary comes from summaries map, null when absent', () => {
    const files = [
      { path: 'src/a.ts', additions: 1, deletions: 0 },
      { path: 'src/b.ts', additions: 1, deletions: 0 },
    ];
    const summaries = new Map([['src/a.ts', 'Adds a helper function.']]);
    const result = buildSmartDiff(files, [], summaries);

    const coreGroup = result.groups.find((g) => g.role === 'core')!;
    const fileA = coreGroup.files.find((f) => f.path === 'src/a.ts')!;
    const fileB = coreGroup.files.find((f) => f.path === 'src/b.ts')!;
    expect(fileA.pseudocode_summary).toBe('Adds a helper function.');
    expect(fileB.pseudocode_summary).toBeNull();
  });

  it('groups are ordered core-above-boilerplate, empty roles skipped', () => {
    const files = [
      { path: 'pnpm-lock.yaml', additions: 10, deletions: 0 },
      { path: 'src/core-logic.ts', additions: 3, deletions: 0 },
      // no wiring file present → wiring role should be skipped entirely
    ];
    const result = buildSmartDiff(files, [], new Map());

    expect(result.groups.map((g) => g.role)).toEqual(['core', 'boilerplate']);
  });

  describe('split_suggestion.too_big', () => {
    it('false when big total lines but few files', () => {
      const files = Array.from({ length: 3 }, (_, i) => ({
        path: `src/file-${i}.ts`,
        additions: 200,
        deletions: 0,
      }));
      const result = buildSmartDiff(files, [], new Map());
      expect(result.split_suggestion.total_lines).toBe(600);
      expect(result.split_suggestion.too_big).toBe(false);
      expect(result.split_suggestion.proposed_splits).toEqual([]);
    });

    it('false when many files but small total lines', () => {
      const files = Array.from({ length: 10 }, (_, i) => ({
        path: `src/file-${i}.ts`,
        additions: 5,
        deletions: 0,
      }));
      const result = buildSmartDiff(files, [], new Map());
      expect(result.split_suggestion.total_lines).toBe(50);
      expect(result.split_suggestion.too_big).toBe(false);
      expect(result.split_suggestion.proposed_splits).toEqual([]);
    });

    it('true when BOTH thresholds met, with proposed_splits per non-empty role', () => {
      const files = [
        ...Array.from({ length: 5 }, (_, i) => ({
          path: `src/core-${i}.ts`,
          additions: 65,
          deletions: 20,
        })),
        { path: 'foo.config.ts', additions: 10, deletions: 0 },
        { path: 'pnpm-lock.yaml', additions: 50, deletions: 0 },
        { path: 'src/another-core.ts', additions: 40, deletions: 0 },
      ];
      const result = buildSmartDiff(files, [], new Map());
      expect(files.length).toBeGreaterThanOrEqual(8);
      expect(result.split_suggestion.total_lines).toBeGreaterThan(500);
      expect(result.split_suggestion.too_big).toBe(true);

      const roleNames = result.groups.map((g) => g.role);
      expect(result.split_suggestion.proposed_splits.map((s) => s.name)).toEqual(roleNames);
      for (const split of result.split_suggestion.proposed_splits) {
        const group = result.groups.find((g) => g.role === split.name)!;
        expect(split.files).toEqual(group.files.map((f) => f.path));
      }
    });
  });
});
