/* FindingsBadgeGroup — severity badge row with hover/click popovers.
   Two modes:
   - Static:  <FindingsBadgeGroup findings={FindingRecord[]} />
              Groups by severity from the array (detail page / timeline).
   - Lazy:    <FindingsBadgeGroup prId="…" counts={{ CRITICAL: 2, … }} />
              Shows counts upfront, fetches full findings on first hover (PR list). */
"use client";

import React from "react";
import { createPortal } from "react-dom";
import { SeverityBadge, CategoryTag, Icon } from "@devdigest/ui";
import type { Severity, Category } from "@devdigest/ui";
import type { FindingRecord } from "@devdigest/shared";
import { usePrReviews } from "@/lib/hooks/reviews";

const SEVERITIES = ["CRITICAL", "WARNING", "SUGGESTION"] as const;

// ── Finding row inside popover ────────────────────────────────────────────────

function FindingRow({ f }: { f: FindingRecord }) {
  const [expanded, setExpanded] = React.useState(false);
  return (
    <div
      onClick={() => setExpanded((x) => !x)}
      style={{
        padding: "10px 14px",
        borderBottom: "1px solid var(--border)",
        display: "flex",
        flexDirection: "column",
        gap: 4,
        cursor: "pointer",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
        <SeverityBadge severity={f.severity as Severity} compact />
        <span
          style={{
            fontSize: 13,
            fontWeight: 600,
            color: "var(--text-primary)",
            flex: 1,
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
        >
          {f.title}
        </span>
        <CategoryTag category={f.category as Category} />
        <Icon.ChevronDown
          size={12}
          style={{
            color: "var(--text-muted)",
            flexShrink: 0,
            transform: expanded ? "rotate(180deg)" : "rotate(0deg)",
            transition: "transform 0.15s",
          }}
        />
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <span className="mono" style={{ fontSize: 11, color: "var(--accent-text)", flexShrink: 0 }}>
          {f.file}:{f.start_line}
        </span>
        <span style={{ display: "inline-flex", alignItems: "center", gap: 4, fontSize: 11, color: "var(--text-muted)" }}>
          <span style={{ width: 6, height: 6, borderRadius: 99, background: "var(--text-muted)", flexShrink: 0 }} />
          {Math.round(f.confidence * 100)}% conf
        </span>
      </div>
      <p
        style={{
          margin: 0,
          fontSize: 12,
          color: "var(--text-secondary)",
          lineHeight: 1.5,
          ...(expanded
            ? {}
            : {
                display: "-webkit-box",
                WebkitLineClamp: 2,
                WebkitBoxOrient: "vertical",
                overflow: "hidden",
              }),
        }}
      >
        {f.rationale}
      </p>
    </div>
  );
}

// ── Popover card (portal, position:fixed) ─────────────────────────────────────

function SeverityPopover({
  severity,
  count,
  findings,
  prId,
  rect,
  popoverRef,
  onMouseEnter,
  onMouseLeave,
}: {
  severity: Severity;
  count: number;
  /** Static mode: findings already available. */
  findings?: FindingRecord[];
  /** Lazy mode: fetch from server when rendered. */
  prId?: string;
  rect: DOMRect;
  popoverRef: React.RefObject<HTMLDivElement | null>;
  onMouseEnter: () => void;
  onMouseLeave: () => void;
}) {
  // usePrReviews is disabled (returns nothing) when prId is null/undefined.
  const { data: reviews, isLoading } = usePrReviews(prId ?? null);

  const displayFindings = React.useMemo<FindingRecord[]>(() => {
    if (findings) return findings;
    if (!reviews) return [];
    return reviews
      .flatMap((r) => r.findings ?? [])
      .filter((f) => !f.dismissed_at && f.severity === severity);
  }, [findings, reviews, severity]);

  const loading = prId ? isLoading : false;
  const left = Math.min(rect.left, window.innerWidth - 392);

  return createPortal(
    <div
      ref={popoverRef}
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
      style={{
        position: "fixed",
        top: rect.bottom + 8,
        left,
        zIndex: 9999,
        width: 380,
        background: "var(--bg-elevated)",
        border: "1px solid var(--border)",
        borderRadius: 10,
        boxShadow: "0 8px 32px rgba(0,0,0,0.18)",
        overflow: "hidden",
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          padding: "10px 14px",
          borderBottom: "1px solid var(--border)",
          background: "var(--bg-surface)",
        }}
      >
        <Icon.Dot size={12} style={{ color: "var(--text-muted)" }} />
        <span
          style={{
            fontSize: 12,
            fontWeight: 700,
            letterSpacing: "0.06em",
            textTransform: "uppercase",
            color: "var(--text-muted)",
          }}
        >
          {count} {severity.charAt(0) + severity.slice(1).toLowerCase()}
        </span>
      </div>
      <div style={{ maxHeight: 420, overflowY: "auto" }}>
        {loading ? (
          <div style={{ padding: "16px 14px", fontSize: 12, color: "var(--text-muted)", textAlign: "center" }}>
            Loading…
          </div>
        ) : displayFindings.length === 0 ? (
          <div style={{ padding: "16px 14px", fontSize: 12, color: "var(--text-muted)", textAlign: "center" }}>
            No findings
          </div>
        ) : (
          displayFindings.map((f) => <FindingRow key={f.id} f={f} />)
        )}
      </div>
    </div>,
    document.body,
  );
}

// ── Single badge with hover + pin ─────────────────────────────────────────────

function SeverityBadgeWithHover({
  severity,
  count,
  findings,
  prId,
}: {
  severity: Severity;
  count: number;
  findings?: FindingRecord[];
  prId?: string;
}) {
  const ref = React.useRef<HTMLSpanElement | null>(null);
  const popoverRef = React.useRef<HTMLDivElement | null>(null);
  const [hovered, setHovered] = React.useState(false);
  const [pinned, setPinned] = React.useState(false);
  const closeTimer = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  const visible = hovered || pinned;
  const rect = visible ? ref.current?.getBoundingClientRect() ?? null : null;

  const open = () => {
    if (closeTimer.current) clearTimeout(closeTimer.current);
    setHovered(true);
  };
  const scheduleClose = () => {
    if (pinned) return;
    if (closeTimer.current) clearTimeout(closeTimer.current);
    setHovered(false);
  };

  React.useEffect(() => {
    if (!pinned) return;
    const handler = (e: MouseEvent) => {
      const target = e.target as Node;
      if (ref.current?.contains(target) || popoverRef.current?.contains(target)) return;
      setPinned(false);
      setHovered(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [pinned]);

  return (
    <>
      <span
        ref={ref}
        onMouseEnter={open}
        onMouseLeave={scheduleClose}
        onClick={(e) => {
          e.stopPropagation();
          if (closeTimer.current) clearTimeout(closeTimer.current);
          setPinned((p) => !p);
        }}
        style={{ cursor: "pointer" }}
      >
        <SeverityBadge severity={severity} count={count} compact />
      </span>
      {rect && (
        <SeverityPopover
          severity={severity}
          count={count}
          findings={findings}
          prId={prId}
          rect={rect}
          popoverRef={popoverRef}
          onMouseEnter={open}
          onMouseLeave={scheduleClose}
        />
      )}
    </>
  );
}

// ── Public component ──────────────────────────────────────────────────────────

type StaticProps = { findings: FindingRecord[]; prId?: never; counts?: never };
type LazyProps = {
  prId: string;
  counts: Partial<Record<string, number>>;
  findings?: never;
};

export function FindingsBadgeGroup(props: StaticProps | LazyProps) {
  const isLazy = "prId" in props && props.prId != null;

  const { sevCounts, findingsBySev } = React.useMemo(() => {
    if (isLazy) {
      const counts = (props as LazyProps).counts;
      return {
        sevCounts: counts as Partial<Record<string, number>>,
        findingsBySev: undefined,
      };
    }
    const findings = (props as StaticProps).findings;
    const map: Partial<Record<Severity, FindingRecord[]>> = {};
    for (const f of findings) {
      const sev = f.severity as Severity;
      (map[sev] ??= []).push(f);
    }
    const counts: Partial<Record<string, number>> = {};
    for (const sev of SEVERITIES) counts[sev] = map[sev]?.length ?? 0;
    return { sevCounts: counts, findingsBySev: map };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isLazy ? (props as LazyProps).counts : (props as StaticProps).findings]);

  const hasBadges = SEVERITIES.some((sev) => (sevCounts[sev] ?? 0) > 0);
  if (!hasBadges) return null;

  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
      {SEVERITIES.filter((sev) => (sevCounts[sev] ?? 0) > 0).map((sev) => (
        <SeverityBadgeWithHover
          key={sev}
          severity={sev}
          count={sevCounts[sev]!}
          findings={findingsBySev?.[sev]}
          prId={isLazy ? (props as LazyProps).prId : undefined}
        />
      ))}
    </span>
  );
}
