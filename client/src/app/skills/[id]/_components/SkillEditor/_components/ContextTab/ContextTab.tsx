/* ContextTab — attach discovered repo documents (specs/docs/insights) to a
   skill's prompt. Mirrors the agent Context tab's row controls (order,
   attach toggle, filename, folder path, bucket badge, Preview) but persists
   to the skill's DISTINCT `attached_doc_paths` field (never `evidence_files`,
   AC-16) and shows a "serializes as" contribution preview (AC-17). */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Badge, Skeleton, ErrorState, Toggle, Icon, Markdown } from "@devdigest/ui";
import type { DiscoveredDocument, DiscoveredDocumentBucket, Skill } from "@devdigest/shared";
import { useActiveRepo } from "@/lib/contexts/repoContext";
import {
  useProjectContext,
  useDocument,
  useSetSkillDocs,
} from "@/lib/hooks/projectContext";

const BUCKET_COLOR: Record<DiscoveredDocumentBucket, string> = {
  specs: "var(--accent)",
  docs: "var(--ok)",
  insights: "var(--warn)",
};

function splitPath(path: string): { filename: string; folder: string } {
  const segments = path.split("/");
  const filename = segments.pop() ?? path;
  return { filename, folder: segments.join("/") };
}

export function ContextTab({ skill }: { skill: Skill }) {
  const t = useTranslations("projectContext");
  const { repoId } = useActiveRepo();

  const {
    data,
    isLoading,
    isError,
    refetch,
  } = useProjectContext(repoId);
  const setSkillDocs = useSetSkillDocs(skill.id);

  const [search, setSearch] = React.useState("");
  const [previewPath, setPreviewPath] = React.useState<string | null>(null);

  const attachedPaths = React.useMemo(
    () => skill.attached_doc_paths ?? [],
    [skill.attached_doc_paths],
  );
  const documents = data?.documents ?? [];
  const docByPath = React.useMemo(() => {
    const map = new Map<string, DiscoveredDocument>();
    for (const doc of documents) map.set(doc.path, doc);
    return map;
  }, [documents]);

  const isAttached = (path: string) => attachedPaths.includes(path);

  const persist = (paths: string[]) => {
    setSkillDocs.mutate({ paths });
  };

  const handleToggle = (path: string, on: boolean) => {
    if (on) {
      if (isAttached(path)) return;
      persist([...attachedPaths, path]);
    } else {
      persist(attachedPaths.filter((p) => p !== path));
    }
  };

  const moveAttached = (path: string, direction: -1 | 1) => {
    const index = attachedPaths.indexOf(path);
    if (index < 0) return;
    const target = index + direction;
    if (target < 0 || target >= attachedPaths.length) return;
    const next = [...attachedPaths];
    const [moved] = next.splice(index, 1);
    next.splice(target, 0, moved!);
    persist(next);
  };

  const togglePreview = (path: string) => {
    setPreviewPath((current) => (current === path ? null : path));
  };

  // Ordered: attached docs (in persisted order) first, then unattached
  // (alphabetical). Search filters visible rows without changing attach
  // state — toggles for filtered-out rows still apply (AC-12 parity).
  const query = search.trim().toLowerCase();
  const attachedOrdered = attachedPaths
    .map((path) => docByPath.get(path))
    .filter((doc): doc is DiscoveredDocument => Boolean(doc));
  const unattached = documents
    .filter((doc) => !isAttached(doc.path))
    .sort((a, b) => a.path.localeCompare(b.path));
  const rows = [...attachedOrdered, ...unattached].filter(
    (doc) => !query || doc.path.toLowerCase().includes(query),
  );

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
    return (
      <ErrorState body={t("skillContext.loadError")} onRetry={() => refetch()} />
    );
  }

  if (data && !data.summary.clone_available) {
    return (
      <div style={{ padding: 28 }}>
        <p style={{ fontSize: 13, color: "var(--text-muted)" }}>
          {t("skillContext.notAvailable")}
        </p>
      </div>
    );
  }

  return (
    <div style={{ padding: 28, maxWidth: 720 }}>
      {/* Header */}
      <div
        style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 8 }}
      >
        <h2 style={{ fontSize: 15, fontWeight: 700, flex: 1 }}>
          {t("skillContext.title")}
        </h2>
        <span
          role="status"
          aria-live="polite"
          style={{ fontSize: 13, color: "var(--text-muted)" }}
        >
          {t("skillContext.attachedCount", { count: attachedPaths.length })}
        </span>
      </div>

      <p style={{ fontSize: 12, color: "var(--text-muted)", marginBottom: 16 }}>
        {t("skillContext.inheritNote")}
      </p>

      {/* Search */}
      <input
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        placeholder={t("skillContext.searchPlaceholder")}
        aria-label={t("skillContext.searchPlaceholder")}
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
      <div style={{ display: "flex", flexDirection: "column", gap: 6, marginBottom: 20 }}>
        {rows.map((doc) => {
          const attached = isAttached(doc.path);
          const { filename, folder } = splitPath(doc.path);
          const order = attachedPaths.indexOf(doc.path);
          const previewing = previewPath === doc.path;

          return (
            <div key={doc.path}>
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 10,
                  padding: "10px 12px",
                  borderRadius: 8,
                  border: "1px solid var(--border)",
                  background: "var(--bg-elevated)",
                  opacity: attached ? 1 : 0.6,
                }}
              >
                {/* Reorder controls — keyboard-operable buttons, not
                    drag-only, so ordering an attached doc doesn't require a
                    mouse. */}
                <div style={{ display: "flex", flexDirection: "column", flexShrink: 0 }}>
                  <button
                    type="button"
                    aria-label={t("skillContext.moveUp")}
                    disabled={!attached || order <= 0}
                    onClick={() => moveAttached(doc.path, -1)}
                    style={{
                      background: "none",
                      border: "none",
                      cursor: attached && order > 0 ? "pointer" : "default",
                      color:
                        attached && order > 0 ? "var(--text-muted)" : "var(--border)",
                      padding: 0,
                      lineHeight: 0,
                    }}
                  >
                    <Icon.ArrowUp size={12} />
                  </button>
                  <button
                    type="button"
                    aria-label={t("skillContext.moveDown")}
                    disabled={!attached || order < 0 || order >= attachedPaths.length - 1}
                    onClick={() => moveAttached(doc.path, 1)}
                    style={{
                      background: "none",
                      border: "none",
                      cursor:
                        attached && order >= 0 && order < attachedPaths.length - 1
                          ? "pointer"
                          : "default",
                      color:
                        attached && order >= 0 && order < attachedPaths.length - 1
                          ? "var(--text-muted)"
                          : "var(--border)",
                      padding: 0,
                      lineHeight: 0,
                    }}
                  >
                    <Icon.ArrowDown size={12} />
                  </button>
                </div>

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
                    {filename}
                  </div>
                  {folder && (
                    <div
                      style={{
                        fontSize: 11,
                        color: "var(--text-muted)",
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        whiteSpace: "nowrap",
                      }}
                    >
                      {folder}
                    </div>
                  )}
                </div>

                {/* Bucket badge — colour + text label (WCAG: not colour-only) */}
                <Badge color={BUCKET_COLOR[doc.bucket]}>
                  {t(`skillContext.bucket.${doc.bucket}`)}
                </Badge>

                {/* Order badge for attached docs */}
                {attached && (
                  <span
                    style={{
                      fontSize: 11,
                      fontFamily: "monospace",
                      color: "var(--text-muted)",
                      flexShrink: 0,
                    }}
                  >
                    #{order + 1}
                  </span>
                )}

                {/* Preview affordance */}
                <button
                  type="button"
                  aria-label={t("skillContext.preview")}
                  aria-expanded={previewing}
                  onClick={() => togglePreview(doc.path)}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 4,
                    background: "none",
                    border: "1px solid var(--border)",
                    borderRadius: 6,
                    padding: "4px 8px",
                    cursor: "pointer",
                    color: "var(--text-secondary)",
                    fontSize: 12,
                    flexShrink: 0,
                  }}
                >
                  <Icon.Eye size={13} />
                  {t("skillContext.preview")}
                </button>
              </div>

              {previewing && (
                <DocumentPreview repoId={repoId} path={doc.path} />
              )}
            </div>
          );
        })}

        {rows.length === 0 && (
          <p
            style={{
              fontSize: 13,
              color: "var(--text-muted)",
              textAlign: "center",
              padding: 24,
            }}
          >
            {t("skillContext.empty")}
          </p>
        )}
      </div>

      {/* "Serializes as" contribution preview (AC-17) */}
      <div
        style={{
          border: "1px solid var(--border)",
          borderRadius: 8,
          background: "var(--bg-elevated)",
          padding: 16,
        }}
      >
        <h3 style={{ fontSize: 13, fontWeight: 700, marginBottom: 8 }}>
          {t("skillContext.serializesAs.heading")}
        </h3>
        <pre
          style={{
            fontFamily: "monospace",
            fontSize: 12,
            lineHeight: 1.6,
            margin: 0,
            whiteSpace: "pre-wrap",
            wordBreak: "break-word",
            color: "var(--text-secondary)",
          }}
        >
          {t("skillContext.serializesAs.contribution", { name: skill.name })}
          {"\n"}
          {attachedPaths.length > 0
            ? attachedPaths.map((p) => `- ${p}`).join("\n")
            : t("skillContext.serializesAs.empty")}
        </pre>
      </div>
    </div>
  );
}

function DocumentPreview({
  repoId,
  path,
}: {
  repoId: string | null | undefined;
  path: string;
}) {
  const t = useTranslations("projectContext");
  const { data, isLoading, isError } = useDocument(repoId, path);

  return (
    <div
      style={{
        marginTop: 6,
        padding: 16,
        border: "1px solid var(--border)",
        borderRadius: 8,
        background: "var(--bg-surface)",
      }}
    >
      {isLoading && <Skeleton height={80} />}
      {isError && (
        <p style={{ fontSize: 12, color: "var(--crit)" }}>
          {t("skillContext.loadError")}
        </p>
      )}
      {data && <Markdown>{data.text}</Markdown>}
    </div>
  );
}
