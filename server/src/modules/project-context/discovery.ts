/**
 * Filesystem discovery for the project-context module (infrastructure layer —
 * I/O only, no business logic beyond bucket assignment).
 *
 * Walks a repo clone's working tree once, collecting every `.md` file nested
 * under a `specs/`, `docs/`, or `insights/` folder at any depth (see
 * `constants.ts` for the configurable bucket set). Per the NFR (p95 <= 2s for
 * <=5k files), discovery never reads file bodies: `estimated_tokens` is
 * derived from `fs.stat().size` using the same chars≈bytes/4 heuristic as
 * `approxTokens` in `adapters/tokenizer` (applied to a byte count instead of
 * already-loaded text, since no text is loaded here). A precise, body-based
 * token count only happens later, when a document is actually read for
 * run-time injection (see `documents.ts`).
 */
import { promises as fs } from 'node:fs';
import { join, sep } from 'node:path';
import type { Tokenizer } from '../../adapters/tokenizer/index.js';
import type { DiscoveredDocument, DiscoverySummary } from '../../vendor/shared/index.js';
import { BUCKETS, type BucketName } from './constants.js';

const SKIP_DIRS = new Set(['.git', 'node_modules']);

const BUCKET_SET: ReadonlySet<string> = new Set(BUCKETS);

/**
 * "Outermost bucket wins" — for a path like `docs/specs/x.md`, the first
 * matching segment walking from the repo root (`docs`) is chosen, not the
 * innermost (`specs`). Deterministic and stable across repeated discovery
 * runs (AC-4).
 */
function bucketForPath(relPath: string): BucketName | null {
  const segments = relPath.split(sep);
  for (const segment of segments) {
    if (BUCKET_SET.has(segment)) {
      return segment as BucketName;
    }
  }
  return null;
}

/**
 * Heuristic token estimate from byte size only (chars ≈ bytes / 4 for UTF-8
 * text) — mirrors `approxTokens` from `adapters/tokenizer`, but operates on a
 * byte count so discovery never has to read the file body to produce it.
 */
function approxTokensFromSize(sizeBytes: number): number {
  return Math.ceil(sizeBytes / 4);
}

async function walk(dir: string, out: string[]): Promise<void> {
  let entries: import('node:fs').Dirent[];
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch {
    // Directory vanished mid-walk or is unreadable — skip it, not fatal.
    return;
  }
  for (const entry of entries) {
    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(entry.name)) continue;
      await walk(join(dir, entry.name), out);
    } else if (entry.isFile() && entry.name.endsWith('.md')) {
      out.push(join(dir, entry.name));
    }
  }
}

function emptySummary(refreshedAt: string, cloneAvailable: boolean): DiscoverySummary {
  return {
    document_count: 0,
    total_estimated_tokens: 0,
    refreshed_at: refreshedAt,
    clone_available: cloneAvailable,
  };
}

/**
 * Discovers every eligible markdown document under `cloneRoot`. `tokenizer`
 * is accepted for interface consistency with other repo-scanning ports and
 * future body-based estimation, but is intentionally unused here — see the
 * module doc comment for why discovery stays byte-size-only.
 */
export async function discover(
  cloneRoot: string | null,
  tokenizer: Tokenizer,
): Promise<{ documents: DiscoveredDocument[]; summary: DiscoverySummary }> {
  void tokenizer;

  const refreshedAt = new Date().toISOString();

  if (!cloneRoot) {
    return { documents: [], summary: emptySummary(refreshedAt, false) };
  }

  try {
    const rootStat = await fs.stat(cloneRoot);
    if (!rootStat.isDirectory()) {
      return { documents: [], summary: emptySummary(refreshedAt, false) };
    }
  } catch {
    return { documents: [], summary: emptySummary(refreshedAt, false) };
  }

  const absolutePaths: string[] = [];
  await walk(cloneRoot, absolutePaths);

  const rootPrefix = cloneRoot.endsWith(sep) ? cloneRoot : cloneRoot + sep;
  const documents: DiscoveredDocument[] = [];

  for (const absPath of absolutePaths) {
    const relPath = absPath.startsWith(rootPrefix) ? absPath.slice(rootPrefix.length) : absPath;
    const bucket = bucketForPath(relPath);
    if (!bucket) continue;

    let sizeBytes = 0;
    try {
      sizeBytes = (await fs.stat(absPath)).size;
    } catch {
      // File vanished between readdir and stat — skip it.
      continue;
    }

    documents.push({
      path: relPath,
      bucket,
      estimated_tokens: approxTokensFromSize(sizeBytes),
    });
  }

  documents.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));

  const totalEstimatedTokens = documents.reduce((sum, doc) => sum + doc.estimated_tokens, 0);

  return {
    documents,
    summary: {
      document_count: documents.length,
      total_estimated_tokens: totalEstimatedTokens,
      refreshed_at: refreshedAt,
      clone_available: true,
    },
  };
}
