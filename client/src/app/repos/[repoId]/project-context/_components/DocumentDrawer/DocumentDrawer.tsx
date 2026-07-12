"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Button, Markdown, Skeleton, Tabs, Textarea } from "@devdigest/ui";
import { useDocument, useSaveDocument } from "@/lib/hooks";
import { splitPath } from "../ProjectContextView/helpers";

export type DrawerMode = "preview" | "edit";

/** Preview/Edit drawer for a single discovered document. Preview renders
    markdown via the shared `Markdown` primitive; Edit is a real, keyboard
    operable `<textarea>`. Save failures surface inline; a resync-clobber
    warning is always shown while editing (AC-34 — no cheap client-side
    git-tracked signal exists, so it's shown for every discovered doc). */
export function DocumentDrawer({
  repoId,
  path,
  initialMode,
  onClose,
}: {
  repoId: string;
  path: string;
  initialMode: DrawerMode;
  onClose: () => void;
}) {
  const t = useTranslations("projectContext");
  const { filename, folder } = splitPath(path);
  const { data, isLoading, isError } = useDocument(repoId, path);
  const saveDocument = useSaveDocument(repoId);

  const [mode, setMode] = React.useState<DrawerMode>(initialMode);
  const [text, setText] = React.useState("");

  // Reset local edit buffer whenever the loaded document changes.
  React.useEffect(() => {
    if (data) setText(data.text);
  }, [data]);

  const handleSave = () => {
    saveDocument.mutate({ path, text });
  };

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        display: "flex",
        justifyContent: "flex-end",
        zIndex: 50,
      }}
    >
      <div
        onClick={onClose}
        style={{ position: "absolute", inset: 0, background: "rgba(0,0,0,0.45)" }}
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-label={filename}
        style={{
          position: "relative",
          width: 720,
          maxWidth: "94%",
          background: "var(--bg-surface)",
          borderLeft: "1px solid var(--border-strong)",
          display: "flex",
          flexDirection: "column",
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "flex-start",
            justifyContent: "space-between",
            gap: 14,
            padding: "18px 24px",
            borderBottom: "1px solid var(--border)",
          }}
        >
          <div style={{ minWidth: 0 }}>
            <div style={{ fontSize: 16, fontWeight: 700 }}>{filename}</div>
            {folder && (
              <div style={{ fontSize: 13, color: "var(--text-secondary)", marginTop: 2 }}>
                {folder}
              </div>
            )}
          </div>
          <button
            type="button"
            aria-label={t("drawer.close")}
            onClick={onClose}
            style={{
              border: "none",
              background: "transparent",
              color: "var(--text-secondary)",
              cursor: "pointer",
              fontSize: 14,
            }}
          >
            {t("drawer.close")}
          </button>
        </div>

        <div style={{ padding: "12px 24px 0" }}>
          <Tabs
            tabs={[
              { key: "preview", label: t("mode.preview") },
              { key: "edit", label: t("mode.edit") },
            ]}
            value={mode}
            onChange={(key) => setMode(key as DrawerMode)}
          />
        </div>

        <div style={{ flex: 1, overflow: "auto", padding: 24 }}>
          {isLoading ? (
            <Skeleton height={200} />
          ) : isError ? (
            <div role="alert" style={{ color: "var(--crit)", fontSize: 13 }}>
              {t("drawer.loadError")}
            </div>
          ) : mode === "preview" ? (
            <Markdown>{data?.text ?? ""}</Markdown>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
              <div
                role="status"
                style={{
                  display: "flex",
                  alignItems: "flex-start",
                  gap: 8,
                  padding: "10px 12px",
                  borderRadius: 7,
                  border: "1px solid var(--warn)",
                  background: "var(--warn-bg)",
                  color: "var(--warn)",
                  fontSize: 13,
                }}
              >
                {t("drawer.resyncWarning")}
              </div>
              <Textarea value={text} onChange={setText} rows={20} mono />
            </div>
          )}
        </div>

        {mode === "edit" && (
          <div
            style={{
              borderTop: "1px solid var(--border)",
              padding: "16px 24px",
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              gap: 12,
            }}
          >
            <div role="status" aria-live="polite" style={{ fontSize: 13 }}>
              {saveDocument.isSuccess && (
                <span style={{ color: "var(--ok)" }}>{t("drawer.saveSuccess")}</span>
              )}
              {saveDocument.isError && (
                <span style={{ color: "var(--crit)" }}>{t("drawer.saveError")}</span>
              )}
            </div>
            <Button
              kind="primary"
              onClick={handleSave}
              loading={saveDocument.isPending}
              disabled={isLoading || isError}
            >
              {t("drawer.save")}
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}
