/* SmartDiffViewer — reviewer-ordered diff: files grouped core → wiring →
   boilerplate (boilerplate collapsed by default), per-file "What this does"
   summaries, "N findings" badges, and inline severity chips — all composed
   CLIENT-SIDE from the SmartDiff contract + the last review's findings.
   Zero new LLM calls: SmartDiff and findings are already-persisted data. */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Icon, SEV } from "@devdigest/ui";
import type { FindingRecord, PrFile, Severity, SmartDiff, SmartDiffFile } from "@devdigest/shared";
import { FileCard } from "@/components/diff-viewer/FileCard";
import type { SeverityChipLabels } from "@/components/diff-viewer/CodeLine";
import { ROLE_META } from "./constants";

/** Sum of additions/deletions across every file in the SmartDiff. */
function totalCounts(smartDiff: SmartDiff): { files: number; additions: number; deletions: number } {
  let files = 0;
  let additions = 0;
  let deletions = 0;
  for (const group of smartDiff.groups) {
    for (const f of group.files) {
      files++;
      additions += f.additions;
      deletions += f.deletions;
    }
  }
  return { files, additions, deletions };
}

/** Join finding_lines (SmartDiffFile) with the last review's findings on
    (file, start_line) to recover severity per line — client-side only. */
function severityMarksFor(
  smartFile: SmartDiffFile,
  findings: FindingRecord[],
): Map<number, Severity> {
  const marks = new Map<number, Severity>();
  if (smartFile.finding_lines.length === 0) return marks;
  const lineSet = new Set(smartFile.finding_lines);
  for (const f of findings) {
    if (f.file !== smartFile.path) continue;
    if (!lineSet.has(f.start_line)) continue;
    const existing = marks.get(f.start_line);
    // Prefer the more severe finding if multiple land on the same line.
    if (!existing || severityRank(f.severity) > severityRank(existing)) {
      marks.set(f.start_line, f.severity);
    }
  }
  return marks;
}

function severityRank(sev: Severity): number {
  return sev === "CRITICAL" ? 2 : sev === "WARNING" ? 1 : 0;
}

/** The finding to deep-link to when the badge is clicked: the one at the
    lowest finding_line, joined the same way as severityMarksFor. */
function firstFindingIdFor(smartFile: SmartDiffFile, findings: FindingRecord[]): string | null {
  if (smartFile.finding_lines.length === 0) return null;
  const lineSet = new Set(smartFile.finding_lines);
  let best: FindingRecord | null = null;
  for (const f of findings) {
    if (f.file !== smartFile.path) continue;
    if (!lineSet.has(f.start_line)) continue;
    if (!best || f.start_line < best.start_line) best = f;
  }
  return best?.id ?? null;
}

/** One reviewer-ordered file group: dot + name + description + count, files. */
function SmartDiffGroupSection({
  role,
  smartFiles,
  filesByPath,
  findings,
  t,
  severityLabels,
  summaryLabel,
  summaryChipLabel,
  onNavigateToFinding,
}: {
  role: "core" | "wiring" | "boilerplate";
  smartFiles: SmartDiffFile[];
  filesByPath: Map<string, PrFile>;
  findings: FindingRecord[];
  t: ReturnType<typeof useTranslations>;
  severityLabels: SeverityChipLabels;
  summaryLabel: string;
  summaryChipLabel: string;
  /** Navigates to the Findings tab, deep-linked to a specific finding. */
  onNavigateToFinding: (findingId: string) => void;
}) {
  const meta = ROLE_META[role];
  // Boilerplate is collapsed by default; core/wiring start expanded.
  const [expanded, setExpanded] = React.useState(role !== "boilerplate");

  if (smartFiles.length === 0) return null;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      <div
        onClick={() => setExpanded((e) => !e)}
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          cursor: "pointer",
          padding: "6px 2px",
        }}
      >
        <Icon.ChevronRight
          size={13}
          style={{
            color: "var(--text-muted)",
            transform: expanded ? "rotate(90deg)" : "none",
            transition: "transform .12s",
          }}
        />
        <span
          aria-hidden
          style={{
            width: 8,
            height: 8,
            borderRadius: "50%",
            background: meta.dotColor,
            flexShrink: 0,
          }}
        />
        <span style={{ fontSize: 13.5, fontWeight: 600, color: "var(--text-primary)" }}>
          {t(meta.labelKey)}
        </span>
        <span style={{ fontSize: 12, color: "var(--text-muted)" }}>{t(meta.descriptionKey)}</span>
        <span style={{ fontSize: 12, color: "var(--text-muted)", marginLeft: "auto" }}>
          {smartFiles.length}
        </span>
      </div>
      {expanded && (
        <div style={{ display: "flex", flexDirection: "column", gap: 8, paddingLeft: 16 }}>
          {smartFiles.map((sf) => {
            const file = filesByPath.get(sf.path);
            if (!file) return null;
            const marksByLine = severityMarksFor(sf, findings);
            const firstFindingId = firstFindingIdFor(sf, findings);
            return (
              <FileCard
                key={sf.path}
                file={file}
                marksByLine={marksByLine}
                findingCount={sf.finding_lines.length}
                findingsLabel={
                  sf.finding_lines.length > 0
                    ? t("smartDiff.findingsBadge", { n: sf.finding_lines.length })
                    : undefined
                }
                onFindingsBadgeClick={firstFindingId ? () => onNavigateToFinding(firstFindingId) : undefined}
                summary={sf.pseudocode_summary ?? undefined}
                summaryLabel={summaryLabel}
                summaryChipLabel={summaryChipLabel}
                severityLabels={severityLabels}
              />
            );
          })}
        </div>
      )}
    </div>
  );
}

export function SmartDiffViewer({
  files,
  smartDiff,
  findings,
}: {
  files: PrFile[];
  smartDiff: SmartDiff;
  findings: FindingRecord[];
}) {
  const t = useTranslations("shell");
  const router = useRouter();
  const pathname = usePathname();
  const search = useSearchParams();

  // Findings badge → Findings tab, deep-linked to the specific finding.
  const navigateToFinding = React.useCallback(
    (findingId: string) => {
      const sp = new URLSearchParams(search.toString());
      sp.set("tab", "findings");
      sp.set("finding", findingId);
      router.push(`${pathname}?${sp.toString()}`);
    },
    [router, pathname, search],
  );

  const filesByPath = React.useMemo(() => {
    const m = new Map<string, PrFile>();
    for (const f of files) m.set(f.path, f);
    return m;
  }, [files]);

  const severityLabels: SeverityChipLabels = React.useMemo(
    () => ({
      CRITICAL: t("smartDiff.severity.CRITICAL"),
      WARNING: t("smartDiff.severity.WARNING"),
      SUGGESTION: t("smartDiff.severity.SUGGESTION"),
    }),
    [t],
  );

  const summaryLabel = t("smartDiff.whatThisDoes");
  const summaryChipLabel = t("smartDiff.summaryChip");

  if (smartDiff.groups.every((g) => g.files.length === 0)) {
    return <div style={{ padding: 24, fontSize: 14, color: "var(--text-muted)", textAlign: "center" }}>{t("smartDiff.empty")}</div>;
  }

  const { files: n, additions, deletions } = totalCounts(smartDiff);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      <div>
        <div
          style={{
            fontSize: 11,
            fontWeight: 700,
            textTransform: "uppercase",
            letterSpacing: "0.06em",
            color: "var(--text-muted)",
          }}
        >
          {t("smartDiff.header")}
        </div>
        <div className="mono tnum" style={{ fontSize: 12.5, color: "var(--text-muted)", marginTop: 2 }}>
          {t("smartDiff.statsLine", { n, a: additions, d: deletions })}
        </div>
      </div>

      {smartDiff.split_suggestion.too_big && (
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 8,
            padding: "10px 12px",
            borderRadius: 7,
            border: `1px solid ${SEV.WARNING.c}55`,
            background: SEV.WARNING.bg,
            fontSize: 13,
            color: "var(--text-primary)",
          }}
        >
          <Icon.AlertTriangle size={14} style={{ color: SEV.WARNING.c, flexShrink: 0 }} />
          {t("smartDiff.splitSuggestion", { lines: smartDiff.split_suggestion.total_lines })}
        </div>
      )}

      {smartDiff.groups.map((group) => (
        <SmartDiffGroupSection
          key={group.role}
          role={group.role}
          smartFiles={group.files}
          filesByPath={filesByPath}
          findings={findings}
          t={t}
          severityLabels={severityLabels}
          summaryLabel={summaryLabel}
          summaryChipLabel={summaryChipLabel}
          onNavigateToFinding={navigateToFinding}
        />
      ))}
    </div>
  );
}
