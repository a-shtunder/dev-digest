/* ContextTab — attach/detach and reorder Project Context documents (repo
   specs/docs/insights) for an agent. Mirrors SkillsTab's attach/reorder UX:
   whole-set replace on save, order = index. Attach state is tracked by
   document PATH (not by visible row), so filtering never drops a toggle. */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Badge, Skeleton, ErrorState, Toggle, IconBtn, Markdown } from "@devdigest/ui";
import type { DiscoveredDocument } from "@devdigest/shared";
import { useActiveRepo } from "@/lib/contexts/repoContext";
import {
  useProjectContext,
  useDocument,
  useSetAgentDocs,
  useAgent,
} from "@/lib/hooks";

const BUCKET_COLOR: Record<string, string> = {
  specs: "var(--accent)",
  docs: "var(--ok)",
  insights: "var(--warn)",
};

function docFolder(path: string): string {
  const idx = path.lastIndexOf("/");
  return idx === -1 ? "" : path.slice(0, idx);
}

function docFilename(path: string): string {
  const idx = path.lastIndexOf("/");
  return idx === -1 ? path : path.slice(idx + 1);
}

export function ContextTab({ agentId }: { agentId: string }) {
  const t = useTranslations("projectContext.agentTab");
  const { repoId } = useActiveRepo();

  const { data: agent, isLoading: agentLoading, isError: agentError } =
    useAgent(agentId);
  const {
    data: contextData,
    isLoading: contextLoading,
    isError: contextError,
    refetch,
  } = useProjectContext(repoId);
  const setDocs = useSetAgentDocs(agentId);

  const [search, setSearch] = React.useState("");
  const [previewPath, setPreviewPath] = React.useState<string | null>(null);
  const [dragOver, setDragOver] = React.useState<string | null>(null);

  const previewDoc = useDocument(repoId, previewPath);

  const attachedPaths: string[] = React.useMemo(
    () => agent?.attached_doc_paths ?? [],
    [agent],
  );

  const isAttached = (path: string) => attachedPaths.includes(path);

  const persist = (paths: string[]) => {
    setDocs.mutate({ paths });
  };

  const handleToggle = (path: string, checked: boolean) => {
    if (checked) {
      persist([...attachedPaths, path]);
    } else {
      persist(attachedPaths.filter((p) => p !== path));
    }
  };

  const handleMove = (path: string, direction: -1 | 1) => {
    const from = attachedPaths.indexOf(path);
    if (from < 0) return;
    const to = from + direction;
    if (to < 0 || to >= attachedPaths.length) return;
    const next = [...attachedPaths];
    const [moved] = next.splice(from, 1);
    next.splice(to, 0, moved!);
    persist(next);
  };

  const handleDrop = (e: React.DragEvent, targetPath: string) => {
    e.preventDefault();
    const draggedPath = e.dataTransfer.getData("docPath");
    setDragOver(null);
    if (!draggedPath || draggedPath === targetPath) return;

    const from = attachedPaths.indexOf(draggedPath);
    const to = attachedPaths.indexOf(targetPath);
    if (from < 0 || to < 0) return;

    const next = [...attachedPaths];
    next.splice(from, 1);
    next.splice(to, 0, draggedPath);
    persist(next);
  };

  const isLoading = agentLoading || contextLoading;
  const isError = agentError || contextError;

  if (isLoading) {
    return (
      <div style={{ padding: 28, display: "flex", flexDirection: "column", gap: 12 }}>
        <Skeleton height={48} />
        <Skeleton height={48} />
        <Skeleton height={48} />
      </div>
    );
  }

  if (isError) {
    return <ErrorState body={t("loadError")} onRetry={() => refetch()} />;
  }

  if (!repoId) {
    return (
      <div style={{ padding: 28 }}>
        <p style={{ fontSize: 13, color: "var(--text-muted)" }}>{t("noRepo")}</p>
      </div>
    );
  }

  const documents = contextData?.documents ?? [];

  if (!contextData?.summary.clone_available) {
    return (
      <div style={{ padding: 28 }}>
        <p style={{ fontSize: 13, color: "var(--text-muted)" }}>
          {t("notAvailable")}
        </p>
      </div>
    );
  }

  const byPath = new Map(documents.map((d) => [d.path, d] as const));

  const matchesSearch = (d: DiscoveredDocument) =>
    !search || d.path.toLowerCase().includes(search.toLowerCase());

  // Attached docs first (in attach order), then unattached alphabetically —
  // mirrors SkillsTab. Search narrows the visible list without touching
  // attach state (attach state lives in `attachedPaths`, keyed by path).
  const sorted = [
    ...(attachedPaths
      .map((p) => byPath.get(p))
      .filter(Boolean) as DiscoveredDocument[]),
    ...documents
      .filter((d) => !isAttached(d.path))
      .sort((a, b) => a.path.localeCompare(b.path)),
  ].filter(matchesSearch);

  const attachedTokens = attachedPaths.reduce((sum, p) => {
    const d = byPath.get(p);
    return sum + (d?.estimated_tokens ?? 0);
  }, 0);

  const previewDocument = previewPath ? byPath.get(previewPath) : undefined;

  return (
    <div style={{ padding: 28, maxWidth: 720 }}>
      {/* Header */}
      <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 8 }}>
        <h2 style={{ fontSize: 15, fontWeight: 700, flex: 1 }}>{t("title")}</h2>
        <span aria-live="polite" style={{ fontSize: 13, color: "var(--text-muted)" }}>
          {t("attachedCount", { attached: attachedPaths.length, total: documents.length })}
        </span>
      </div>

      <p style={{ fontSize: 12, color: "var(--text-muted)", marginBottom: 4 }}>
        {t("orderHint")}
      </p>
      <p style={{ fontSize: 12, color: "var(--text-muted)", marginBottom: 16 }}>
        {t("tokenEstimate", { tokens: attachedTokens })} — {t("untrustedNote")}
      </p>

      {/* Search */}
      <input
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        placeholder={t("searchPlaceholder")}
        aria-label={t("searchPlaceholder")}
        style={{
          width: "100%",
          padding: "6px 10px",
          marginBottom: 14,
          border: "1px solid var(--border)",
          borderRadius: 7,
          background: "var(--bg-elevated)",
          fontSize: 13,
          color: "var(--text-primary)",
          boxSizing: "border-box",
        }}
      />

      {/* Document rows */}
      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        {sorted.map((doc) => {
          const attached = isAttached(doc.path);
          const idx = attachedPaths.indexOf(doc.path);

          return (
            <div
              key={doc.path}
              draggable={attached}
              onDragStart={(e) => e.dataTransfer.setData("docPath", doc.path)}
              onDragOver={(e) => {
                if (attached) {
                  e.preventDefault();
                  setDragOver(doc.path);
                }
              }}
              onDragLeave={() => setDragOver(null)}
              onDrop={(e) => handleDrop(e, doc.path)}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 10,
                padding: "10px 12px",
                borderRadius: 8,
                border: `1px solid ${dragOver === doc.path ? "var(--accent)" : "var(--border)"}`,
                background: dragOver === doc.path ? "var(--accent-bg)" : "var(--bg-elevated)",
                opacity: attached ? 1 : 0.6,
              }}
            >
              {/* Drag handle */}
              <span
                style={{
                  cursor: attached ? "grab" : "default",
                  color: attached ? "var(--text-muted)" : "transparent",
                  fontSize: 16,
                  userSelect: "none",
                  flexShrink: 0,
                }}
              >
                ≡
              </span>

              {/* Keyboard reorder alternative to drag */}
              {attached && (
                <div style={{ display: "flex", flexDirection: "column", flexShrink: 0 }}>
                  <IconBtn
                    icon="ArrowUp"
                    label={t("moveUp")}
                    size={18}
                    onClick={() => handleMove(doc.path, -1)}
                  />
                  <IconBtn
                    icon="ArrowDown"
                    label={t("moveDown")}
                    size={18}
                    onClick={() => handleMove(doc.path, 1)}
                  />
                </div>
              )}

              {/* Attach toggle */}
              <Toggle
                on={attached}
                size={13}
                onChange={(checked) => handleToggle(doc.path, checked)}
              />

              {/* Filename + folder path */}
              <div style={{ flex: 1, minWidth: 0 }}>
                <div
                  style={{
                    fontWeight: 600,
                    fontSize: 13,
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                  }}
                >
                  {docFilename(doc.path)}
                </div>
                <div
                  style={{
                    fontSize: 11,
                    color: "var(--text-muted)",
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                  }}
                >
                  {docFolder(doc.path)}
                </div>
              </div>

              <Badge color={BUCKET_COLOR[doc.bucket] ?? "var(--text-muted)"}>
                {t(`bucket.${doc.bucket}`)}
              </Badge>

              {attached && (
                <span
                  style={{
                    fontSize: 11,
                    fontFamily: "monospace",
                    color: "var(--text-muted)",
                    flexShrink: 0,
                  }}
                >
                  #{idx + 1}
                </span>
              )}

              <IconBtn
                icon="Eye"
                label={t("preview")}
                size={26}
                onClick={() => setPreviewPath(doc.path)}
              />
            </div>
          );
        })}
        {sorted.length === 0 && (
          <p style={{ fontSize: 13, color: "var(--text-muted)", textAlign: "center", padding: 24 }}>
            {t("noMatch")}
          </p>
        )}
      </div>

      {/* Preview drawer */}
      {previewPath && previewDocument && (
        <div
          role="dialog"
          aria-label={t("preview")}
          style={{
            position: "fixed",
            top: 0,
            right: 0,
            bottom: 0,
            width: 480,
            maxWidth: "100%",
            background: "var(--bg-elevated)",
            borderLeft: "1px solid var(--border)",
            boxShadow: "-8px 0 24px rgba(0,0,0,0.2)",
            padding: 24,
            overflowY: "auto",
            zIndex: 50,
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12 }}>
            <h3 style={{ fontSize: 14, fontWeight: 700, flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              {previewDocument.path}
            </h3>
            <IconBtn icon="X" label={t("close")} onClick={() => setPreviewPath(null)} />
          </div>

          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12, flexWrap: "wrap" }}>
            <Badge color={BUCKET_COLOR[previewDocument.bucket] ?? "var(--text-muted)"}>
              {t(`bucket.${previewDocument.bucket}`)}
            </Badge>
            <span style={{ fontSize: 12, color: "var(--text-muted)" }}>
              {t("tokenEstimate", { tokens: previewDocument.estimated_tokens })}
            </span>
            <span style={{ fontSize: 12, color: "var(--text-muted)" }}>
              {t("usedByAgents", { count: previewDocument.used_by_agents ?? 0 })}
            </span>
            <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, marginLeft: "auto" }}>
              <Toggle
                on={isAttached(previewDocument.path)}
                size={13}
                onChange={(checked) => handleToggle(previewDocument.path, checked)}
              />
              {isAttached(previewDocument.path) ? t("detach") : t("attach")}
            </label>
          </div>

          {previewDoc.isLoading && <Skeleton height={200} />}
          {previewDoc.isError && <ErrorState body={t("loadError")} />}
          {previewDoc.data && <Markdown>{previewDoc.data.text}</Markdown>}
        </div>
      )}
    </div>
  );
}
