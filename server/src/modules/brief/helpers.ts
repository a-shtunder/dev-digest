/**
 * helpers.ts — pure ref-validation helpers for the Why+Risk PR Brief Card.
 *
 * Onion layer: application (pure functions, no I/O, no adapters). Validates
 * `file:line` / `file:startLine-endLine` locators embedded in `Risk.file_refs`
 * and `ReviewFocusItem.file_ref` against the set of files actually changed
 * in the PR, dedupes them deterministically, and drops anything left invalid.
 *
 * Line-number ranges are intentionally NOT validated against file length
 * (AC-6 edge case) — only the file part is checked against `changedFiles`.
 */
import type { Risk, ReviewFocusItem } from '@devdigest/shared';

export interface ParsedRef {
  file: string;
  startLine: number;
  endLine?: number;
}

export interface DropResult<T> {
  kept: T[];
  dropped: T[];
}

/**
 * Parses a `file:line` or `file:startLine-endLine` locator string.
 * Returns null if the string doesn't match the expected shape.
 *
 * The file part may itself contain colons (e.g. Windows paths) — only the
 * trailing `:line` or `:start-end` segment is treated as the locator.
 */
export function parseFileRef(ref: string): ParsedRef | null {
  const match = /^(.+):(\d+)(?:-(\d+))?$/.exec(ref);
  if (!match) return null;

  const [, file, startStr, endStr] = match;
  if (!file) return null;

  const startLine = Number(startStr);
  const endLine = endStr !== undefined ? Number(endStr) : undefined;

  return endLine !== undefined ? { file, startLine, endLine } : { file, startLine };
}

/** Deterministic dedupe key: path + line range. */
function refKey(parsed: ParsedRef): string {
  return `${parsed.file}:${parsed.startLine}${parsed.endLine !== undefined ? `-${parsed.endLine}` : ''}`;
}

/**
 * Validates and dedupes a list of `file:line` ref strings against the set of
 * files changed in the PR. Invalid (unparseable or unknown-file) refs are
 * dropped; duplicates (same path+range) collapse to a single kept ref,
 * deterministically by first occurrence order.
 */
export function validateAndDedupeRefs(refs: string[], changedFiles: ReadonlySet<string>): DropResult<string> {
  const kept: string[] = [];
  const dropped: string[] = [];
  const seen = new Set<string>();

  for (const ref of refs) {
    const parsed = parseFileRef(ref);
    if (!parsed || !changedFiles.has(parsed.file)) {
      dropped.push(ref);
      continue;
    }

    const key = refKey(parsed);
    if (seen.has(key)) {
      dropped.push(ref);
      continue;
    }

    seen.add(key);
    kept.push(ref);
  }

  return { kept, dropped };
}

/**
 * Validates a Risk's `file_refs` against the changed-file set, dedupes them,
 * and returns null if the risk is left with zero valid refs (AC-7).
 */
export function validateRisk(risk: Risk, changedFiles: ReadonlySet<string>): { risk: Risk | null; dropped: string[] } {
  const { kept, dropped } = validateAndDedupeRefs(risk.file_refs, changedFiles);
  if (kept.length === 0) {
    return { risk: null, dropped: [...risk.file_refs] };
  }
  return { risk: { ...risk, file_refs: kept }, dropped };
}

/**
 * Validates a list of Risks: drops any risk left with zero valid refs after
 * dedupe/validation. Returns kept risks plus the risks that were dropped
 * entirely (for service-level logging, AC-8).
 */
export function validateRisks(risks: Risk[], changedFiles: ReadonlySet<string>): DropResult<Risk> {
  const kept: Risk[] = [];
  const dropped: Risk[] = [];

  for (const risk of risks) {
    const { risk: validated } = validateRisk(risk, changedFiles);
    if (validated) {
      kept.push(validated);
    } else {
      dropped.push(risk);
    }
  }

  return { kept, dropped };
}

/**
 * Validates a list of ReviewFocusItems: a focus item whose `file_ref` is
 * invalid (unparseable or referencing a file not in the PR) is dropped.
 */
export function validateReviewFocus(
  items: ReviewFocusItem[],
  changedFiles: ReadonlySet<string>,
): DropResult<ReviewFocusItem> {
  const kept: ReviewFocusItem[] = [];
  const dropped: ReviewFocusItem[] = [];

  for (const item of items) {
    const parsed = parseFileRef(item.file_ref);
    if (parsed && changedFiles.has(parsed.file)) {
      kept.push(item);
    } else {
      dropped.push(item);
    }
  }

  return { kept, dropped };
}

/**
 * Fallback: derive review-focus items straight from risks, one per distinct
 * risky file (first ref only), when the model returns risks but skips
 * review_focus. In practice several models reliably fill `risks` from this
 * prompt but leave `review_focus` empty even when explicitly instructed to
 * populate it — this guarantees a reviewer always gets a starting point
 * whenever the Brief actually flagged something risky, without depending on
 * model compliance. Only ever used to fill gaps; never overrides
 * model-authored review_focus items.
 */
export function deriveReviewFocusFromRisks(risks: Risk[]): ReviewFocusItem[] {
  const seenFiles = new Set<string>();
  const items: ReviewFocusItem[] = [];

  for (const risk of risks) {
    const ref = risk.file_refs[0];
    if (!ref) continue;
    const parsed = parseFileRef(ref);
    if (!parsed || seenFiles.has(parsed.file)) continue;
    seenFiles.add(parsed.file);
    items.push({ label: risk.title, file_ref: ref, reason: risk.explanation });
  }

  return items;
}
