import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ValidationError } from '../../platform/errors.js';
import { assertInsideClone, assertInsideCloneForWrite } from './path-guard.js';

describe('path-guard', () => {
  let cloneRoot: string;
  let outsideDir: string;

  beforeEach(async () => {
    cloneRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'pg-clone-'));
    outsideDir = await fs.mkdtemp(path.join(os.tmpdir(), 'pg-outside-'));

    await fs.mkdir(path.join(cloneRoot, 'docs'), { recursive: true });
    await fs.writeFile(path.join(cloneRoot, 'docs', 'x.md'), 'hello', 'utf8');

    await fs.writeFile(path.join(outsideDir, 'secret.txt'), 'nope', 'utf8');
    // Symlink inside the clone whose realpath escapes cloneRoot.
    await fs.symlink(
      path.join(outsideDir, 'secret.txt'),
      path.join(cloneRoot, 'escape-link.txt'),
    );
  });

  afterEach(async () => {
    await fs.rm(cloneRoot, { recursive: true, force: true });
    await fs.rm(outsideDir, { recursive: true, force: true });
  });

  it('accepts a normal in-tree file for read', async () => {
    const result = await assertInsideClone(cloneRoot, 'docs/x.md');
    expect(result).toBe(path.resolve(cloneRoot, 'docs/x.md'));
  });

  it('accepts a new in-tree file for write', async () => {
    const result = await assertInsideCloneForWrite(cloneRoot, 'docs/new-file.md');
    expect(result).toBe(path.resolve(cloneRoot, 'docs/new-file.md'));
  });

  it('rejects "../../etc/passwd" for read and write', async () => {
    await expect(assertInsideClone(cloneRoot, '../../etc/passwd')).rejects.toThrow(
      ValidationError,
    );
    await expect(assertInsideCloneForWrite(cloneRoot, '../../etc/passwd')).rejects.toThrow(
      ValidationError,
    );
  });

  it('rejects an absolute path "/etc/passwd" for read and write', async () => {
    await expect(assertInsideClone(cloneRoot, '/etc/passwd')).rejects.toThrow(ValidationError);
    await expect(assertInsideCloneForWrite(cloneRoot, '/etc/passwd')).rejects.toThrow(
      ValidationError,
    );
  });

  it('rejects a symlink whose realpath escapes the clone, for read and write', async () => {
    await expect(assertInsideClone(cloneRoot, 'escape-link.txt')).rejects.toThrow(
      ValidationError,
    );
    await expect(assertInsideCloneForWrite(cloneRoot, 'escape-link.txt')).rejects.toThrow(
      ValidationError,
    );
  });
});
