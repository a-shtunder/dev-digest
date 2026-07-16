/* hooks/eval.ts — React Query hooks for the L06 Eval Pipeline (agent regression
   evals): per-agent eval cases, run history, agent/workspace dashboards, and the
   one-click "Turn into eval case" / run mutations. Mirrors agents.ts / reviews.ts. */
"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "../api";
import type {
  EvalCase,
  EvalCaseInput,
  EvalDashboard,
  EvalOverview,
  EvalRun,
  EvalRunRecord,
  EvalRunResult,
} from "@devdigest/shared";

// ---------------------------------------------------------------------------
// Queries
// ---------------------------------------------------------------------------

/** All eval cases owned by one agent, within the caller's workspace. */
export function useEvalCases(agentId: string | null | undefined) {
  return useQuery({
    queryKey: ["eval-cases", agentId],
    queryFn: () => api.get<EvalCase[]>(`/agents/${agentId}/eval-cases`),
    enabled: !!agentId,
  });
}

/** Chronological run history for one eval case. */
export function useEvalCaseRuns(caseId: string | null | undefined) {
  return useQuery({
    queryKey: ["eval-case-runs", caseId],
    queryFn: () => api.get<EvalRunRecord[]>(`/eval-cases/${caseId}/runs`),
    enabled: !!caseId,
  });
}

/** Aggregated eval dashboard (current/delta/trend/recent_runs/alert) for one agent. */
export function useEvalAgentDashboard(agentId: string | null | undefined) {
  return useQuery({
    queryKey: ["eval-agent-dashboard", agentId],
    queryFn: () => api.get<EvalDashboard>(`/agents/${agentId}/eval-dashboard`),
    enabled: !!agentId,
  });
}

/** Workspace-wide eval overview: one summary per review agent + recent runs. */
export function useEvalWorkspaceDashboard() {
  return useQuery({
    queryKey: ["eval-dashboard"],
    queryFn: () => api.get<EvalOverview>("/eval/dashboard"),
  });
}

// ---------------------------------------------------------------------------
// Mutations
// ---------------------------------------------------------------------------

/**
 * One-click "Turn into eval case" — resolves finding -> review -> pull
 * (workspace-scoped server-side) and creates an `owner_kind: 'agent'` case
 * with a file-sliced `input_diff` and an `expected_output` derived from the
 * finding's accept/dismiss decision.
 */
export function useCreateEvalCaseFromFinding() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (findingId: string) =>
      api.post<EvalCase>(`/findings/${findingId}/eval-case`),
    onSuccess: (data) => {
      qc.invalidateQueries({ queryKey: ["eval-cases", data.owner_id] });
    },
  });
}

/** Generic eval-case create (case editor "New eval case" / "Save"). */
export function useCreateEvalCase() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: EvalCaseInput) =>
      api.post<EvalCase>(`/agents/${input.owner_id}/eval-cases`, input),
    onSuccess: (data) => {
      qc.invalidateQueries({ queryKey: ["eval-cases", data.owner_id] });
    },
  });
}

/** Generic eval-case update — updates an existing case in place (case editor
 *  "Save" when editing a case that already has an id). */
export function useUpdateEvalCase() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, input }: { id: string; input: EvalCaseInput }) =>
      api.patch<EvalCase>(`/eval-cases/${id}`, input),
    onSuccess: (data) => {
      qc.invalidateQueries({ queryKey: ["eval-cases", data.owner_id] });
    },
  });
}

/** Deletes a case (its run history cascades server-side). `agentId` is only
 *  needed to invalidate that agent's case list — the delete response carries
 *  no case body to read it back from. */
export function useDeleteEvalCase() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id }: { id: string; agentId: string }) =>
      api.del<{ ok: true }>(`/eval-cases/${id}`),
    onSuccess: (_data, { agentId }) => {
      qc.invalidateQueries({ queryKey: ["eval-cases", agentId] });
      qc.invalidateQueries({ queryKey: ["eval-agent-dashboard", agentId] });
    },
  });
}

/** Batch run — runs every eval case owned by an agent (Evals tab "Run all evals",
    Compare modal "Promote" re-run). */
export function useRunEvalSet() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (agentId: string) =>
      api.post<EvalRun>(`/agents/${agentId}/eval-runs`),
    onSuccess: (_data, agentId) => {
      qc.invalidateQueries({ queryKey: ["eval-cases", agentId] });
      qc.invalidateQueries({ queryKey: ["eval-agent-dashboard", agentId] });
      qc.invalidateQueries({ queryKey: ["eval-dashboard"] });
    },
  });
}

/** Single-case run (case editor "Run case" button). */
export function useRunEvalCase() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (caseId: string) =>
      api.post<EvalRunResult>(`/eval-cases/${caseId}/run`),
    onSuccess: (data) => {
      qc.invalidateQueries({ queryKey: ["eval-case-runs", data.case_id] });
    },
  });
}
