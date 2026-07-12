import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Tokenizer } from '../../adapters/tokenizer/index.js';
import { discover } from './discovery.js';

/** Discovery never reads bodies (byte-size heuristic) — the mock tokenizer's
 *  `count` is never actually invoked, but is provided for interface parity. */
const mockTokenizer: Tokenizer = { count: () => 0 };

describe('discover', () => {
  let cloneRoot: string;

  beforeEach(async () => {
    cloneRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'discovery-clone-'));
  });

  afterEach(async () => {
    await fs.rm(cloneRoot, { recursive: true, force: true });
  });

  it('clone-absent (null root) returns empty documents + clone_available: false', async () => {
    const result = await discover(null, mockTokenizer);
    expect(result.documents).toEqual([]);
    expect(result.summary.clone_available).toBe(false);
    expect(result.summary.document_count).toBe(0);
  });

  it('clone-absent (missing dir on disk) returns empty documents + clone_available: false', async () => {
    const result = await discover(path.join(cloneRoot, 'does-not-exist'), mockTokenizer);
    expect(result.documents).toEqual([]);
    expect(result.summary.clone_available).toBe(false);
  });

  it('includes .md files nested under specs/docs/insights at any depth and excludes files outside those buckets', async () => {
    await fs.mkdir(path.join(cloneRoot, 'specs', 'nested'), { recursive: true });
    await fs.mkdir(path.join(cloneRoot, 'docs'), { recursive: true });
    await fs.mkdir(path.join(cloneRoot, 'insights'), { recursive: true });
    await fs.mkdir(path.join(cloneRoot, 'src'), { recursive: true });
    await fs.mkdir(path.join(cloneRoot, 'node_modules', 'pkg'), { recursive: true });
    await fs.mkdir(path.join(cloneRoot, '.git'), { recursive: true });

    await fs.writeFile(path.join(cloneRoot, 'specs', 'a.md'), 'hello spec');
    await fs.writeFile(path.join(cloneRoot, 'specs', 'nested', 'b.md'), 'nested spec');
    await fs.writeFile(path.join(cloneRoot, 'docs', 'c.md'), 'doc');
    await fs.writeFile(path.join(cloneRoot, 'insights', 'd.md'), 'insight');
    await fs.writeFile(path.join(cloneRoot, 'src', 'e.md'), 'not eligible — outside any bucket');
    await fs.writeFile(path.join(cloneRoot, 'README.md'), 'not eligible — repo root');
    await fs.writeFile(path.join(cloneRoot, 'node_modules', 'pkg', 'f.md'), 'excluded dir');
    await fs.writeFile(path.join(cloneRoot, '.git', 'g.md'), 'excluded dir');

    const result = await discover(cloneRoot, mockTokenizer);
    const paths = result.documents.map((d) => d.path).sort();

    expect(paths).toEqual([
      'docs/c.md',
      'insights/d.md',
      'specs/a.md',
      'specs/nested/b.md',
    ]);
    // Not included: outside a bucket, node_modules, .git.
    expect(paths).not.toContain('src/e.md');
    expect(paths).not.toContain('README.md');
  });

  it('each result carries path, bucket, and estimated_tokens (AC-2)', async () => {
    await fs.mkdir(path.join(cloneRoot, 'docs'), { recursive: true });
    await fs.writeFile(path.join(cloneRoot, 'docs', 'x.md'), 'x'.repeat(40));

    const result = await discover(cloneRoot, mockTokenizer);
    expect(result.documents).toHaveLength(1);
    const doc = result.documents[0]!;
    expect(doc.path).toBe('docs/x.md');
    expect(doc.bucket).toBe('docs');
    expect(typeof doc.estimated_tokens).toBe('number');
    expect(doc.estimated_tokens).toBeGreaterThan(0);
  });

  it('outermost-bucket-wins: docs/specs/x.md is bucketed as "docs", stable across repeated calls', async () => {
    await fs.mkdir(path.join(cloneRoot, 'docs', 'specs'), { recursive: true });
    await fs.writeFile(path.join(cloneRoot, 'docs', 'specs', 'x.md'), 'nested spec inside docs');

    const first = await discover(cloneRoot, mockTokenizer);
    const second = await discover(cloneRoot, mockTokenizer);

    expect(first.documents).toHaveLength(1);
    expect(first.documents[0]!.bucket).toBe('docs');
    expect(second.documents[0]!.bucket).toBe('docs');
  });

  it('the bucket set is configurable, not inline: changing BUCKETS changes what discovery returns (AC-3)', async () => {
    await fs.mkdir(path.join(cloneRoot, 'guides'), { recursive: true });
    await fs.mkdir(path.join(cloneRoot, 'docs'), { recursive: true });
    await fs.writeFile(path.join(cloneRoot, 'guides', 'x.md'), 'not eligible with default buckets');
    await fs.writeFile(path.join(cloneRoot, 'docs', 'y.md'), 'eligible with default buckets');

    // Default bucket set excludes 'guides/'.
    const defaultResult = await discover(cloneRoot, mockTokenizer);
    expect(defaultResult.documents.map((d) => d.path)).toEqual(['docs/y.md']);

    // Re-import discovery.ts with a mocked constants.ts whose BUCKETS includes
    // 'guides' — proves the bucket set is read from constants.ts, not hardcoded.
    vi.resetModules();
    vi.doMock('./constants.js', () => ({
      BUCKETS: ['guides'] as const,
    }));
    const { discover: discoverWithCustomBuckets } = await import('./discovery.js');
    const customResult = await discoverWithCustomBuckets(cloneRoot, mockTokenizer);
    expect(customResult.documents.map((d) => d.path)).toEqual(['guides/x.md']);

    vi.doUnmock('./constants.js');
    vi.resetModules();
  });

  it('summary reflects document_count and the sum of estimated_tokens', async () => {
    await fs.mkdir(path.join(cloneRoot, 'docs'), { recursive: true });
    await fs.writeFile(path.join(cloneRoot, 'docs', 'a.md'), 'a'.repeat(20));
    await fs.writeFile(path.join(cloneRoot, 'docs', 'b.md'), 'b'.repeat(20));

    const result = await discover(cloneRoot, mockTokenizer);
    expect(result.summary.document_count).toBe(2);
    expect(result.summary.clone_available).toBe(true);
    const sum = result.documents.reduce((n, d) => n + d.estimated_tokens, 0);
    expect(result.summary.total_estimated_tokens).toBe(sum);
    expect(typeof result.summary.refreshed_at).toBe('string');
  });
});
