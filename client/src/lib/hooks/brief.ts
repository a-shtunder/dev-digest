/* hooks/brief.ts — React Query hooks for the PR Why+Risk Brief card. */
"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "../api";
import type { PrBriefResponse } from "@devdigest/shared";

/** GET /pulls/:id/brief returns the cached brief, or this empty-state marker when none exists yet. */
type BriefEmptyState = { generated: false; brief: null };

/** Fetch the brief for a PR. Empty state means no cache exists — call useGenerateBrief to create one. */
export function useBrief(prId: string | number | null | undefined) {
  return useQuery({
    queryKey: ["brief", prId],
    queryFn: () =>
      api.get<PrBriefResponse | BriefEmptyState>(`/pulls/${prId}/brief`),
    enabled: prId != null,
  });
}

/** Trigger a fresh brief generation for a PR and invalidate the cached brief. */
export function useGenerateBrief(prId: string | number | null | undefined) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api.post<PrBriefResponse>(`/pulls/${prId}/brief`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["brief", prId] }),
  });
}
