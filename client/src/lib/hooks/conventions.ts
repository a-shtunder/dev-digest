/* hooks/conventions.ts — React Query hooks for the Conventions Extractor (L02).
   Skill creation from accepted candidates reuses useCreateSkill (hooks/skills). */
"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../api";
import type { ConventionCandidate } from "@devdigest/shared";

const key = (repoId: string) => ["conventions", repoId] as const;

export function useConventions(repoId: string | null | undefined) {
  return useQuery({
    queryKey: ["conventions", repoId],
    queryFn: () => api.get<ConventionCandidate[]>(`/repos/${repoId}/conventions`),
    enabled: !!repoId,
  });
}

/** Run a fresh extraction. Seeds the list cache with the returned candidates. */
export function useExtractConventions(repoId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () =>
      api.post<ConventionCandidate[]>(`/repos/${repoId}/conventions/extract`),
    onSuccess: (data) => qc.setQueryData(key(repoId), data),
  });
}

export function useAcceptConvention(repoId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.post<ConventionCandidate>(`/conventions/${id}/accept`),
    onSuccess: () => qc.invalidateQueries({ queryKey: key(repoId) }),
  });
}

/** Deselect (un-accept) a candidate but keep it in the list — used by "Deselect all". */
export function useDeselectConvention(repoId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.post<ConventionCandidate>(`/conventions/${id}/reject`),
    onSuccess: () => qc.invalidateQueries({ queryKey: key(repoId) }),
  });
}

/** Remove a candidate from the list entirely (the card's Reject action). */
export function useDeleteConvention(repoId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.del<{ deleted: string }>(`/conventions/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: key(repoId) }),
  });
}

/** Edit a candidate's rule text (persists, so it survives reload and feeds the skill). */
export function useUpdateConvention(repoId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, rule }: { id: string; rule: string }) =>
      api.patch<ConventionCandidate>(`/conventions/${id}`, { rule }),
    onSuccess: () => qc.invalidateQueries({ queryKey: key(repoId) }),
  });
}
