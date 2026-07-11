/**
 * classifier.ts — pure Smart Diff computation. No `this`, no IO, no LLM.
 *
 * Onion layer: application-layer helper (deterministic recomposition of
 * already-stored data). Input interfaces here are DB-type-free so this file
 * stays unit-testable without any DB/Fastify/LLM dependency.
 */
import { SmartDiff, type SmartDiffFile, type SmartDiffGroup, type SmartDiffRole, type ProposedSplit } from '@devdigest/shared';
import {
  ROLE_ORDER,
  BOILERPLATE_PATTERNS,
  WIRING_PATTERNS,
  SPLIT_TOO_BIG_TOTAL_LINES,
  SPLIT_MIN_FILES,
} from './constants.js';

export interface SmartDiffFileInput {
  path: string;
  additions: number;
  deletions: number;
}

export interface SmartDiffFindingInput {
  file: string;
  start_line: number;
}

/** boilerplate → wiring → core (first match wins). */
export function classifyFile(path: string): SmartDiffRole {
  if (BOILERPLATE_PATTERNS.some((re) => re.test(path))) return 'boilerplate';
  if (WIRING_PATTERNS.some((re) => re.test(path))) return 'wiring';
  return 'core';
}

export function buildSmartDiff(
  files: SmartDiffFileInput[],
  findings: SmartDiffFindingInput[],
  summaries: Map<string, string>,
): SmartDiff {
  const byRole = new Map<SmartDiffRole, SmartDiffFile[]>();

  for (const file of files) {
    const role = classifyFile(file.path);
    const findingLines = [
      ...new Set(
        findings.filter((f) => f.file === file.path).map((f) => f.start_line),
      ),
    ].sort((a, b) => a - b);

    const smartDiffFile: SmartDiffFile = {
      path: file.path,
      pseudocode_summary: summaries.get(file.path) ?? null,
      additions: file.additions,
      deletions: file.deletions,
      finding_lines: findingLines,
    };

    const bucket = byRole.get(role);
    if (bucket) bucket.push(smartDiffFile);
    else byRole.set(role, [smartDiffFile]);
  }

  const groups: SmartDiffGroup[] = ROLE_ORDER.filter((role) => byRole.has(role)).map(
    (role) => ({ role, files: byRole.get(role)! }),
  );

  const totalLines = files.reduce((sum, f) => sum + f.additions + f.deletions, 0);
  const tooBig = totalLines > SPLIT_TOO_BIG_TOTAL_LINES && files.length >= SPLIT_MIN_FILES;

  const proposedSplits: ProposedSplit[] = tooBig
    ? groups.map((group) => ({ name: group.role, files: group.files.map((f) => f.path) }))
    : [];

  return SmartDiff.parse({
    groups,
    split_suggestion: {
      too_big: tooBig,
      total_lines: totalLines,
      proposed_splits: proposedSplits,
    },
  });
}
