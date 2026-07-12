/* hooks/projectContext.ts — React Query hooks for the Project Context feature
   (discovered repo documents, document read/save, agent/skill attachment). */
"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "../api";
import type {
  DiscoveredDocument,
  DiscoverySummary,
  DocumentContent,
  SaveDocumentBody,
  SetAttachedDocsBody,
} from "@devdigest/shared";

export interface ProjectContextData {
  documents: DiscoveredDocument[];
  summary: DiscoverySummary;
}

export function useProjectContext(repoId: string | null | undefined) {
  return useQuery({
    queryKey: ["project-context", repoId],
    queryFn: () =>
      api.get<ProjectContextData>(`/repos/${repoId}/project-context`),
    enabled: !!repoId,
  });
}

export function useDocument(
  repoId: string | null | undefined,
  path: string | null | undefined
) {
  return useQuery({
    queryKey: ["project-document", repoId, path],
    queryFn: () =>
      api.get<DocumentContent>(
        `/repos/${repoId}/project-context/document?path=${encodeURIComponent(path!)}`
      ),
    enabled: !!repoId && !!path,
  });
}

export function useSaveDocument(repoId: string | null | undefined) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: SaveDocumentBody) =>
      api.put<DocumentContent>(
        `/repos/${repoId}/project-context/document`,
        body
      ),
    onSuccess: (data) => {
      qc.setQueryData(["project-document", repoId, data.path], data);
    },
  });
}

export function useSetAgentDocs(agentId: string | null | undefined) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: SetAttachedDocsBody) =>
      api.put(`/agents/${agentId}/attached-docs`, body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["agent", agentId] });
      qc.invalidateQueries({ queryKey: ["agents"] });
    },
  });
}

export function useSetSkillDocs(skillId: string | null | undefined) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: SetAttachedDocsBody) =>
      api.put(`/skills/${skillId}/attached-docs`, body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["skill", skillId] });
      qc.invalidateQueries({ queryKey: ["skills"] });
    },
  });
}
