/**
 * Guarded document read/write for the project-context module.
 *
 * Both `readDocument` and `writeDocument` route through the T3 path guard
 * (`assertInsideClone` / `assertInsideCloneForWrite`) so the same security
 * boundary covers Preview, Edit-save, and run-time injection — never call
 * `GitClient.readFile` directly for these use cases, it is unguarded.
 *
 * `writeDocument` performs a plain working-tree `fs.writeFile`. It never
 * shells out to git (no add/commit/push) — resync (`git reset --hard`) can
 * clobber an uncommitted edit; that limitation is surfaced as a UI warning
 * elsewhere, not handled here.
 */
import { promises as fs } from 'node:fs';
import type { GitClient, RepoRef } from '@devdigest/shared';
import { assertInsideClone, assertInsideCloneForWrite } from './path-guard.js';

/**
 * Reads a document from the repo's git clone working tree, guarded against
 * path traversal / symlink escape. Throws if the file does not exist or is
 * otherwise unreadable (e.g. not valid UTF-8) so callers can skip-and-record.
 */
export async function readDocument(
  git: GitClient,
  repoRef: RepoRef,
  path: string,
): Promise<string> {
  const cloneRoot = git.clonePathFor(repoRef);
  const absolutePath = await assertInsideClone(cloneRoot, path);
  return fs.readFile(absolutePath, 'utf8');
}

/**
 * Writes a document into the repo's git clone working tree, guarded against
 * path traversal / symlink escape. Performs no git operation. Throws if the
 * write target's parent directory does not exist, so a save failure is
 * reported to the caller rather than silently dropped.
 */
export async function writeDocument(
  git: GitClient,
  repoRef: RepoRef,
  path: string,
  text: string,
): Promise<void> {
  const cloneRoot = git.clonePathFor(repoRef);
  const absolutePath = await assertInsideCloneForWrite(cloneRoot, path);
  await fs.writeFile(absolutePath, text, 'utf8');
}
