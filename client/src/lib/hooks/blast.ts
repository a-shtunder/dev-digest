/* hooks/blast.ts — React Query hook for the Blast Radius card (L04). */
"use client";

import { useQuery } from "@tanstack/react-query";
import { api } from "../api";
import type { BlastRadiusResult } from "@devdigest/shared";

export function useBlastRadius(prId: string | number | null | undefined) {
  return useQuery({
    queryKey: ["blast-radius", prId],
    queryFn: () => api.get<BlastRadiusResult>(`/pulls/${prId}/blast-radius`),
    enabled: prId != null,
  });
}
