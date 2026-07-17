import type { CSSProperties } from "react";

/** Co-located styles for CompareRuns. */
export const s = {
  body: { padding: 24, display: "flex", flexDirection: "column", gap: 20 } satisfies CSSProperties,
  metricsGrid: {
    display: "grid",
    gridTemplateColumns: "repeat(3, 1fr)",
    gap: 12,
  } satisfies CSSProperties,
  metricCard: {
    border: "1px solid var(--border)",
    borderRadius: 10,
    padding: "12px 14px",
    background: "var(--bg-surface)",
  } satisfies CSSProperties,
  metricLabel: {
    fontSize: 11,
    fontWeight: 700,
    letterSpacing: "0.04em",
    color: "var(--text-muted)",
    textTransform: "uppercase",
  } satisfies CSSProperties,
  metricRow: {
    display: "flex",
    alignItems: "center",
    gap: 6,
    fontSize: 15,
    fontWeight: 600,
    marginTop: 6,
  } satisfies CSSProperties,
  arrow: { color: "var(--text-muted)", fontSize: 12 } satisfies CSSProperties,
  metricDelta: { fontSize: 12.5, color: "var(--text-secondary)", marginTop: 4 } satisfies CSSProperties,
  sectionTitle: { fontSize: 13, fontWeight: 700, marginBottom: 8 } satisfies CSSProperties,
  diffBlock: {
    margin: 0,
    padding: "12px 14px",
    borderRadius: 10,
    border: "1px solid var(--border)",
    background: "var(--bg-surface)",
    fontSize: 12.5,
    lineHeight: 1.6,
    whiteSpace: "pre-wrap",
    maxHeight: 320,
    overflow: "auto",
  } satisfies CSSProperties,
  diffSame: { color: "var(--text-secondary)" } satisfies CSSProperties,
  diffAdded: { color: "var(--good)", background: "rgba(34,197,94,0.08)" } satisfies CSSProperties,
  diffRemoved: {
    color: "var(--crit)",
    background: "rgba(239,68,68,0.08)",
    textDecoration: "line-through",
  } satisfies CSSProperties,
  noSnapshot: {
    fontSize: 13,
    color: "var(--text-muted)",
    padding: "12px 14px",
    border: "1px dashed var(--border)",
    borderRadius: 10,
  } satisfies CSSProperties,
  footer: {
    display: "flex",
    alignItems: "center",
    gap: 10,
  } satisfies CSSProperties,
  promoteNote: { fontSize: 12, color: "var(--text-muted)", flex: 1 } satisfies CSSProperties,
  statusNote: { fontSize: 12.5, color: "var(--text-secondary)" } satisfies CSSProperties,
  errorNote: { fontSize: 12.5, color: "var(--crit)" } satisfies CSSProperties,
} as const;
