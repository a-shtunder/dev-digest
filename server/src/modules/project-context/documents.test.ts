/**
 * T5 documents.test.ts — guarded read/write round-trip, no git side effects
 * (AC-32/AC-33). `readDocument`/`writeDocument` take `git: GitClient` as an
 * explicit parameter, so a plain object literal satisfying `clonePathFor` is
 * enough here (per server/insights/INSIGHTS.md — no need for the full
 * `MockGitClient`).
 */
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { GitClient, RepoRef } from '@devdigest/shared';
import { ValidationError } from '../../platform/errors.js';
import { readDocument, writeDocument } from './documents.js';

describe('documents', () => {
  let cloneRoot: string;
  let git: GitClient;
  const repoRef: RepoRef = { owner: 'octo', name: 'demo' };

  beforeEach(async () => {
    cloneRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'documents-clone-'));
    await fs.mkdir(path.join(cloneRoot, 'docs'), { recursive: true });
    await fs.writeFile(path.join(cloneRoot, 'docs', 'x.md'), 'original text', 'utf8');
    git = { clonePathFor: () => cloneRoot } as unknown as GitClient;
  });

  afterEach(async () => {
    await fs.rm(cloneRoot, { recursive: true, force: true });
  });

  it('reads an existing file', async () => {
    const text = await readDocument(git, repoRef, 'docs/x.md');
    expect(text).toBe('original text');
  });

  it('write then read round-trips the new text, with no git side effects', async () => {
    await writeDocument(git, repoRef, 'docs/x.md', 'updated text');
    const text = await readDocument(git, repoRef, 'docs/x.md');
    expect(text).toBe('updated text');
    // No git shell-out: the fake GitClient exposes only clonePathFor and was
    // never asked to do anything else — a plain fs write, no add/commit/push.
    const raw = await fs.readFile(path.join(cloneRoot, 'docs', 'x.md'), 'utf8');
    expect(raw).toBe('updated text');
  });

  it('writing a brand-new in-tree file persists it', async () => {
    await writeDocument(git, repoRef, 'docs/new.md', 'brand new');
    const text = await readDocument(git, repoRef, 'docs/new.md');
    expect(text).toBe('brand new');
  });

  it('a traversal path is refused for both read and write (delegates to the T3 guard)', async () => {
    await expect(readDocument(git, repoRef, '../../etc/passwd')).rejects.toThrow(ValidationError);
    await expect(writeDocument(git, repoRef, '../../etc/passwd', 'x')).rejects.toThrow(
      ValidationError,
    );
  });

  it('reading a missing file throws (fail-soft skip is the caller\'s job)', async () => {
    await expect(readDocument(git, repoRef, 'docs/does-not-exist.md')).rejects.toThrow();
  });
});
