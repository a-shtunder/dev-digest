/* FileCard — one collapsible file in the diff: header (path, +/- stat, comment
   count) and, when open, its parsed lines plus any outdated comments. */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Icon } from "@devdigest/ui";
import type { Severity } from "@devdigest/shared";
import type { PrFile } from "@/lib/types";
import { AUTO_EXPAND_MAX_LINES } from "../constants";
import { parsePatch, type Line } from "../helpers";
import {
  buildThreads,
  keysForLine,
  partitionThreads,
  type CommentThread,
  type DiffCommentApi,
} from "../comments";
import { s, chevronFor } from "../styles";
import { CodeLine, type SeverityChipLabels } from "../CodeLine";
import { OutdatedComments } from "../OutdatedComments";

/** Threads anchored to a given parsed line (RIGHT=new, LEFT=old). */
function threadsForLine(ln: Line, matched: Map<string, CommentThread[]>): CommentThread[] {
  if (matched.size === 0) return [];
  const out: CommentThread[] = [];
  for (const key of keysForLine(ln)) {
    const list = matched.get(key);
    if (list) out.push(...list);
  }
  return out;
}

export function FileCard({
  file,
  commenting,
  marksByLine,
  findingCount,
  summary,
  summaryLabel,
  summaryChipLabel,
  findingsLabel,
  severityLabels,
}: {
  file: PrFile;
  commenting?: DiffCommentApi;
  /** Smart Diff only: severity per new-line-number, for row highlight + inline chip. No-op when omitted. */
  marksByLine?: Map<number, Severity>;
  /** Smart Diff only: "N findings" badge; clicking it auto-expands the file and scrolls to the first finding line. */
  findingCount?: number;
  /** Smart Diff only: "What this does" summary row (pseudocode_summary), rendered above the diff when present. */
  summary?: string;
  /** i18n label for the summary row heading ("What this does"). Required together with `summary`. */
  summaryLabel?: string;
  /** i18n label for the static purple "summary" presence-marker chip. Required together with `summary`. */
  summaryChipLabel?: string;
  /** i18n template for the findings badge ("{n} findings"). Required together with `findingCount`. */
  findingsLabel?: string;
  /** i18n labels for inline severity chips (blocker/warning/suggestion). Required together with `marksByLine`. */
  severityLabels?: SeverityChipLabels;
}) {
  const t = useTranslations("shell");
  const [open, setOpen] = React.useState(
    (file.additions ?? 0) + (file.deletions ?? 0) <= AUTO_EXPAND_MAX_LINES
  );
  const lines = React.useMemo(() => parsePatch(file.patch), [file.patch]);
  const firstFindingLineRef = React.useRef<HTMLDivElement | null>(null);

  // Group this file's comments into threads, then split into ones we can anchor
  // to a rendered line vs. "outdated" (GitHub dropped the line / it's not here).
  const comments = commenting?.comments;
  const { matched, outdated } = React.useMemo(() => {
    if (!comments) return { matched: new Map<string, CommentThread[]>(), outdated: [] };
    const fileThreads = buildThreads(comments.filter((c) => c.path === file.path));
    const renderedKeys = new Set<string>();
    for (const ln of lines) for (const k of keysForLine(ln)) renderedKeys.add(k);
    return partitionThreads(fileThreads, renderedKeys);
  }, [comments, file.path, lines]);

  const commentCount = commenting
    ? commenting.comments.filter((c) => c.path === file.path).length
    : 0;

  // Smart Diff only: first finding line (lowest marked newNo), used to scroll on
  // badge click. No-op (stays -1) when marksByLine is not provided.
  const firstFindingNewNo = React.useMemo(() => {
    if (!marksByLine || marksByLine.size === 0) return -1;
    return Math.min(...marksByLine.keys());
  }, [marksByLine]);

  const handleFindingsBadgeClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    setOpen(true);
    // Wait a tick for the body to mount before scrolling to it.
    requestAnimationFrame(() => {
      firstFindingLineRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
    });
  };

  return (
    <div style={s.fileCard}>
      <div onClick={() => setOpen((o) => !o)} style={s.fileHeader}>
        <Icon.ChevronRight size={13} style={chevronFor(open)} />
        <Icon.FileText size={14} style={s.fileIcon} />
        <span className="mono" style={s.filePath}>
          {file.path}
        </span>
        <span className="mono tnum" style={s.fileStat}>
          <span style={s.addText}>+{file.additions}</span>{" "}
          <span style={s.delText}>−{file.deletions}</span>
        </span>
        {commentCount > 0 && (
          <span
            style={{ display: "inline-flex", alignItems: "center", gap: 4, fontSize: 12, color: "var(--text-muted)" }}
          >
            <Icon.MessageSquare size={12} />
            {commentCount}
          </span>
        )}
        {!!findingCount && findingCount > 0 && (
          <button
            type="button"
            onClick={handleFindingsBadgeClick}
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 4,
              fontSize: 11.5,
              fontWeight: 600,
              color: "var(--warn)",
              background: "var(--warn-bg)",
              border: "1px solid var(--border)",
              borderRadius: 999,
              padding: "2px 8px",
              cursor: "pointer",
            }}
          >
            <Icon.AlertTriangle size={11} />
            {findingsLabel ?? findingCount}
          </button>
        )}
      </div>
      {summary && (
        <div
          style={{
            display: "flex",
            alignItems: "flex-start",
            gap: 8,
            padding: "8px 12px",
            borderTop: "1px solid var(--border)",
            background: "var(--bg-elevated)",
            fontSize: 12.5,
            color: "var(--text-secondary)",
          }}
        >
          <span
            style={{
              flexShrink: 0,
              fontSize: 10.5,
              fontWeight: 700,
              textTransform: "uppercase",
              letterSpacing: "0.04em",
              color: "#a78bfa",
              background: "#a78bfa22",
              border: "1px solid #a78bfa55",
              borderRadius: 4,
              padding: "1px 6px",
            }}
          >
            {summaryChipLabel}
          </span>
          <span>
            <strong style={{ color: "var(--text-primary)" }}>{summaryLabel}:</strong> {summary}
          </span>
        </div>
      )}
      {open && (
        <div style={s.fileBody}>
          {lines.length === 0 ? (
            <div style={s.noDiff}>{t("diffViewer.noDiffText")}</div>
          ) : (
            lines.map((ln, i) => {
              const severity = marksByLine && ln.newNo != null ? marksByLine.get(ln.newNo) : undefined;
              const isFirstFinding = marksByLine != null && ln.newNo === firstFindingNewNo;
              return (
                <div key={i} ref={isFirstFinding ? firstFindingLineRef : undefined}>
                  <CodeLine
                    ln={ln}
                    path={file.path}
                    threads={threadsForLine(ln, matched)}
                    commenting={commenting}
                    severity={severity}
                    severityLabels={severityLabels}
                  />
                </div>
              );
            })
          )}
          {commenting && commenting.showComments && <OutdatedComments threads={outdated} />}
        </div>
      )}
    </div>
  );
}
