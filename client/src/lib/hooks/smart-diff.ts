/* hooks/smart-diff.ts — React Query hook for the Smart Diff (reviewer-ordered
   diff) endpoint. Zero LLM calls: purely a deterministic recomposition of
   already-persisted PR files + the last review's findings/summaries. */
"use client";

import { useQuery } from "@tanstack/react-query";
import { api } from "../api";
import type { SmartDiff } from "@devdigest/shared";

/** Fetch the Smart Diff for a PR (grouped core/wiring/boilerplate + findings). */
export function useSmartDiff(prId: string | null | undefined) {
  return useQuery({
    queryKey: ["smart-diff", prId],
    queryFn: () => api.get<SmartDiff>(`/pulls/${prId}/smart-diff`),
    enabled: !!prId,
  });
}
