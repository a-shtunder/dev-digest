/* CompareRuns/helpers.ts — pure helpers: prompt-snapshot extraction (fail-soft
   when a run predates snapshots), a minimal LCS line-diff for the system
   prompt, and metric formatting for the deltas grid. No React, no hooks. */
import type { EvalRunRecord } from "@devdigest/shared";

export type PromptSnapshot = { system_prompt: string; model?: string };

function isPromptSnapshot(value: unknown): value is PromptSnapshot {
  return (
    !!value &&
    typeof value === "object" &&
    typeof (value as Record<string, unknown>).system_prompt === "string"
  );
}

/**
 * Reads `{ prompt_snapshot: { system_prompt, model } }` out of a run's
 * `actual_output` jsonb blob (persisted per T3/T4). Returns null — never
 * throws — when the run predates snapshots or the shape doesn't match.
 */
export function extractPromptSnapshot(run: EvalRunRecord): PromptSnapshot | null {
  const output = run.actual_output;
  if (!output || typeof output !== "object") return null;
  const snapshot = (output as Record<string, unknown>).prompt_snapshot;
  return isPromptSnapshot(snapshot) ? snapshot : null;
}

export type DiffLine = { type: "same" | "added" | "removed"; text: string };

/** Minimal LCS-based line diff — sufficient for a system-prompt diff view. */
export function diffLines(a: string, b: string): DiffLine[] {
  const aLines = a.split("\n");
  const bLines = b.split("\n");
  const n = aLines.length;
  const m = bLines.length;
  const lcs: number[][] = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      const row = lcs[i]!;
      const rowNext = lcs[i + 1]!;
      row[j] = aLines[i] === bLines[j] ? rowNext[j + 1]! + 1 : Math.max(rowNext[j]!, row[j + 1]!);
    }
  }
  const out: DiffLine[] = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    const aLine = aLines[i]!;
    const bLine = bLines[j]!;
    if (aLine === bLine) {
      out.push({ type: "same", text: aLine });
      i++;
      j++;
    } else if (lcs[i + 1]![j]! >= lcs[i]![j + 1]!) {
      out.push({ type: "removed", text: aLine });
      i++;
    } else {
      out.push({ type: "added", text: bLine });
      j++;
    }
  }
  while (i < n) out.push({ type: "removed", text: aLines[i++]! });
  while (j < m) out.push({ type: "added", text: bLines[j++]! });
  return out;
}

/** `+X.X%` / `-X.X%` / `±0.0%` — null when either run lacks the metric. */
export function formatDelta(a: number | null, b: number | null): string {
  if (a === null || b === null) return "—";
  const delta = b - a;
  const pct = (delta * 100).toFixed(1);
  if (delta > 0) return `+${pct}%`;
  if (delta < 0) return `${pct}%`;
  return `±${pct}%`;
}

export function formatMetric(value: number | null): string {
  return value === null ? "—" : `${(value * 100).toFixed(1)}%`;
}

export function formatRunLabel(run: EvalRunRecord): string {
  return run.case_name ?? run.case_id;
}
