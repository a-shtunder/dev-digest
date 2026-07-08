/* ConventionCard — one extracted convention: rule, evidence (a code card that
   deep-links to the cited line on GitHub), confidence, and accept/reject. */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Button, IconBtn, Icon, Textarea } from "@devdigest/ui";
import type { ConventionCandidate } from "@devdigest/shared";

function confidenceTone(confidence: number) {
  if (confidence >= 0.85) return { bar: "var(--ok)", text: "var(--ok)", bg: "var(--ok-bg)" };
  if (confidence >= 0.7) return { bar: "var(--warn)", text: "var(--warn)", bg: "var(--warn-bg)" };
  return { bar: "var(--warn)", text: "var(--warn)", bg: "var(--warn-bg)" };
}

export function ConventionCard({
  candidate,
  onAccept,
  onReject,
  onSaveRule,
  busy,
}: {
  candidate: ConventionCandidate;
  onAccept: () => void;
  onReject: () => void;
  onSaveRule: (rule: string) => void;
  busy: boolean;
}) {
  const t = useTranslations("conventions");
  const [copied, setCopied] = React.useState(false);
  const [editing, setEditing] = React.useState(false);
  const [draft, setDraft] = React.useState(candidate.rule);
  const pct = Math.round(candidate.confidence * 100);
  const tone = confidenceTone(candidate.confidence);
  const accepted = candidate.accepted;

  const startEdit = () => {
    setDraft(candidate.rule);
    setEditing(true);
  };
  const saveEdit = () => {
    const next = draft.trim();
    if (next && next !== candidate.rule) onSaveRule(next);
    setEditing(false);
  };

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(candidate.evidence_snippet);
      setCopied(true);
      setTimeout(() => setCopied(false), 1200);
    } catch {
      /* clipboard blocked — ignore */
    }
  };

  return (
    <div
      style={{
        background: "var(--bg-elevated)",
        border: "1px solid var(--border)",
        borderLeft: `3px solid ${accepted ? "var(--ok)" : "transparent"}`,
        borderRadius: 12,
        padding: 20,
        display: "flex",
        gap: 20,
        boxShadow: "var(--shadow-drawer)",
        transition: "border-color .12s",
      }}
    >
      <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: 14 }}>
        {editing ? (
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            <Textarea value={draft} onChange={setDraft} rows={2} />
            <div style={{ display: "flex", gap: 8 }}>
              <Button
                kind="primary"
                size="sm"
                icon="Check"
                onClick={saveEdit}
                disabled={busy || !draft.trim()}
              >
                {t("card.save")}
              </Button>
              <Button kind="ghost" size="sm" onClick={() => setEditing(false)}>
                {t("card.cancel")}
              </Button>
            </div>
          </div>
        ) : (
          <div style={{ display: "flex", alignItems: "flex-start", gap: 8 }}>
            <h3
              style={{
                flex: 1,
                fontSize: 15,
                fontWeight: 700,
                fontStyle: "italic",
                lineHeight: 1.45,
              }}
            >
              {candidate.rule}
            </h3>
            <div style={{ flexShrink: 0 }}>
              <IconBtn icon="Edit" label={t("card.edit")} onClick={startEdit} />
            </div>
          </div>
        )}

        {/* Evidence — a proper code card, high contrast in both themes. */}
        <div
          style={{
            background: "var(--code-bg)",
            border: "1px solid var(--border-strong)",
            borderRadius: 10,
            overflow: "hidden",
          }}
        >
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 8,
              padding: "8px 10px 8px 12px",
              borderBottom: "1px solid var(--border)",
              background: "var(--bg-surface)",
            }}
          >
            <Icon.FileText size={13} style={{ color: "var(--text-muted)", flexShrink: 0 }} />
            {candidate.evidence_url ? (
              <a
                href={candidate.evidence_url}
                target="_blank"
                rel="noopener noreferrer"
                className="mono"
                style={{
                  color: "var(--accent-text)",
                  textDecoration: "none",
                  fontSize: 12.5,
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 5,
                  minWidth: 0,
                }}
              >
                <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {candidate.evidence_path}
                </span>
                <Icon.ExternalLink size={12} style={{ flexShrink: 0 }} />
              </a>
            ) : (
              <span className="mono" style={{ color: "var(--text-secondary)", fontSize: 12.5 }}>
                {candidate.evidence_path}
              </span>
            )}
            <div style={{ marginLeft: "auto", flexShrink: 0 }}>
              <IconBtn
                icon={copied ? "Check" : "Copy"}
                label="Copy snippet"
                onClick={copy}
              />
            </div>
          </div>
          <pre
            className="mono"
            style={{
              margin: 0,
              padding: "12px 14px",
              fontSize: 12.5,
              lineHeight: 1.55,
              overflow: "auto",
              color: "var(--text-primary)",
              whiteSpace: "pre",
            }}
          >
            {candidate.evidence_snippet}
          </pre>
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <span style={{ fontSize: 12, color: "var(--text-muted)" }}>{t("card.confidence")}</span>
          <div
            style={{
              width: 160,
              height: 6,
              background: "var(--bg-hover)",
              borderRadius: 99,
              overflow: "hidden",
            }}
          >
            <div style={{ width: `${pct}%`, height: "100%", background: tone.bar, borderRadius: 99 }} />
          </div>
          <span
            className="mono tnum"
            style={{
              fontSize: 12,
              fontWeight: 700,
              color: tone.text,
              background: tone.bg,
              padding: "2px 8px",
              borderRadius: 99,
            }}
          >
            {pct}%
          </span>
        </div>
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 8, flexShrink: 0, width: 118 }}>
        <Button
          kind={accepted ? "primary" : "secondary"}
          size="sm"
          icon="Check"
          onClick={onAccept}
          disabled={busy}
          title={accepted ? t("card.accepted") : t("card.accept")}
          style={{ width: "100%", justifyContent: "center" }}
        >
          {accepted ? t("card.accepted") : t("card.accept")}
        </Button>
        <Button
          kind="ghost"
          size="sm"
          icon="X"
          onClick={onReject}
          disabled={busy}
          style={{ width: "100%", justifyContent: "center" }}
        >
          {t("card.reject")}
        </Button>
      </div>
    </div>
  );
}
