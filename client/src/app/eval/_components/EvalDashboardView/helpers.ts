/* EvalDashboardView/helpers.ts — pure helpers for the workspace Eval Dashboard
   (agent grid + drill-in + run-selection for Compare). No React, no hooks. */
import type { EvalAgentSummary, EvalTrendPoint } from "@devdigest/shared";

/** An agent summary has data worth showing once at least one run has scored it. */
export function hasRuns(agent: EvalAgentSummary): boolean {
  return agent.traces_total > 0;
}

/** Pull one metric's values out of a trend series, chronological, for a sparkline/chart. */
export function trendSeries(
  trend: EvalTrendPoint[],
  key: "recall" | "precision" | "citation_accuracy",
): number[] {
  return trend.map((p) => p[key]);
}

/** `0.873` -> `"87%"`. */
export function formatPercent(value: number): string {
  return `${Math.round(value * 100)}%`;
}

/** `null` -> "-"; otherwise a locale date/time string. */
export function formatRunDate(isoDate: string): string {
  const d = new Date(isoDate);
  return Number.isNaN(d.getTime()) ? isoDate : d.toLocaleString();
}

/**
 * Toggles a run id in/out of a (max 2) selection used to open the Compare
 * modal. Selecting a 3rd run drops the oldest selection (FIFO), so the user
 * never has to explicitly deselect before picking a different pair.
 */
export function toggleRunSelection(selected: string[], runId: string): string[] {
  if (selected.includes(runId)) return selected.filter((id) => id !== runId);
  if (selected.length >= 2) return [selected[1]!, runId];
  return [...selected, runId];
}
