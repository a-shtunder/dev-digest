/**
 * Path traversal / symlink-escape guard for the project-context module.
 *
 * `assertInsideClone` and `assertInsideCloneForWrite` are the single security
 * boundary that gates every file read/write derived from a user-supplied
 * relative path inside a git clone (Preview, Edit-save, run-time injection).
 * String-level `..` checks are insufficient because a symlink physically
 * inside the clone can still resolve outside it — the guard always confirms
 * containment via `fs.realpath`.
 */
import { promises as fs } from 'node:fs';
import { basename, dirname, isAbsolute, join, resolve, sep } from 'node:path';
import { ValidationError } from '../../platform/errors.js';

/** Rejects absolute paths and any path segment containing `..`. */
function assertSafeRelPath(relPath: string): void {
  if (isAbsolute(relPath)) {
    throw new ValidationError('Path must be relative to the clone root', { relPath });
  }
  const normalizedSegments = relPath.split(/[\\/]+/);
  if (normalizedSegments.includes('..')) {
    throw new ValidationError('Path must not contain ".."', { relPath });
  }
}

/** Verifies `realPath` is `cloneRoot` itself or nested inside it. */
function assertContained(realCloneRoot: string, realPath: string, relPath: string): void {
  if (realPath !== realCloneRoot && !realPath.startsWith(realCloneRoot + sep)) {
    throw new ValidationError('Path escapes the repository clone', { relPath });
  }
}

/**
 * Validates a relative path resolves inside `cloneRoot` for a **read**. The
 * target file must already exist (its own realpath is checked, so a symlink
 * target that itself points outside `cloneRoot` is rejected).
 *
 * @returns the validated absolute path
 */
export async function assertInsideClone(cloneRoot: string, relPath: string): Promise<string> {
  assertSafeRelPath(relPath);

  const resolvedRoot = resolve(cloneRoot);
  const resolvedPath = resolve(join(resolvedRoot, relPath));

  let realCloneRoot: string;
  let realPath: string;
  try {
    realCloneRoot = await fs.realpath(resolvedRoot);
    realPath = await fs.realpath(resolvedPath);
  } catch {
    throw new ValidationError('Path does not exist', { relPath });
  }

  assertContained(realCloneRoot, realPath, relPath);
  return resolvedPath;
}

/**
 * Validates a relative path resolves inside `cloneRoot` for a **write**.
 * Tolerates a not-yet-existing target file: the target's parent directory is
 * realpath-ed instead (a brand-new file is allowed; a symlinked parent
 * directory pointing outside the clone is rejected).
 *
 * @returns the validated absolute path
 */
export async function assertInsideCloneForWrite(
  cloneRoot: string,
  relPath: string,
): Promise<string> {
  assertSafeRelPath(relPath);

  const resolvedRoot = resolve(cloneRoot);
  const resolvedPath = resolve(join(resolvedRoot, relPath));
  const parentDir = dirname(resolvedPath);

  let realCloneRoot: string;
  let realParentDir: string;
  try {
    realCloneRoot = await fs.realpath(resolvedRoot);
    realParentDir = await fs.realpath(parentDir);
  } catch {
    throw new ValidationError('Parent directory does not exist', { relPath });
  }

  // If the target already exists, verify its own realpath too — otherwise a
  // symlinked file (with a legitimate parent dir) could still point outside.
  // If it does not exist yet (the common write case), derive its would-be
  // real path from the already-verified real parent directory.
  let realTarget = join(realParentDir, basename(resolvedPath));
  try {
    realTarget = await fs.realpath(resolvedPath);
  } catch {
    // Target does not exist yet — that's fine for a write.
  }

  assertContained(realCloneRoot, realParentDir, relPath);
  assertContained(realCloneRoot, realTarget, relPath);
  return resolvedPath;
}
