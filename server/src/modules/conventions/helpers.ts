import type { ConventionCandidate } from '@devdigest/shared';
import type { ConventionRow } from './repository.js';

/**
 * `evidencePath` is stored as `"<path>:<line>"` (e.g. `src/api/users.ts:23`).
 * Split the trailing `:<line>` (and optional `-<end>`) back out so we can build
 * a GitHub deep-link. Repo paths are posix, so the last `:` is unambiguous.
 */
export function parseEvidencePath(evidencePath: string): { path: string; line?: number } {
  const m = evidencePath.match(/^(.*):(\d+)(?:-\d+)?$/);
  if (!m) return { path: evidencePath };
  return { path: m[1]!, line: Number(m[2]) };
}

/** Build a GitHub blob deep-link to a file line. */
export function buildGithubBlobUrl(
  owner: string,
  name: string,
  branch: string,
  path: string,
  line?: number,
): string {
  const base = `https://github.com/${owner}/${name}/blob/${branch}/${path}`;
  return line && line > 0 ? `${base}#L${line}` : base;
}

export function toConventionDto(
  row: ConventionRow,
  evidenceUrl?: string | null,
): ConventionCandidate {
  return {
    id: row.id,
    rule: row.rule,
    evidence_path: row.evidencePath ?? '',
    evidence_snippet: row.evidenceSnippet ?? '',
    confidence: row.confidence ?? 0,
    accepted: row.accepted,
    ...(evidenceUrl !== undefined ? { evidence_url: evidenceUrl } : {}),
  };
}
