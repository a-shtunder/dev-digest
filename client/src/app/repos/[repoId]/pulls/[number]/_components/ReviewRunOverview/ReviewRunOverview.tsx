/* ReviewRunOverview — full-width block at the TOP of the PR overview tab
   (above the Intent/Blast-Radius row), visually matching the existing
   VerdictBanner used in the Findings tab (same icon box / title row /
   summary / score layout — reuses its styles + verdict meta directly) so
   the "request changes" verdict reads as one consistent design language.
   Derives a compact summary (verdict/score/findings-by-severity/blockers/
   cost) from the latest COMPLETED review run, reusing the existing
   `usePrReviews` + `usePrRuns` hooks (GET /pulls/:id/reviews, GET
   /pulls/:id/runs) — no new endpoint. Deliberately omits token telemetry
   (only a cost sum), per AC-23..26: when there is no completed run yet,
   this block renders nothing (neutral) rather than an empty/zero state, so
   it doesn't compete with PrBriefCard's own empty state. */
"use client";

import React from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useTranslations } from "next-intl";
import { CircularScore, Icon } from "@devdigest/ui";
import { Severity, type FindingRecord, type ReviewRecord } from "@devdigest/shared";
import { SeverityChip } from "@/components/SeverityChip/SeverityChip";
import { usePrReviews, usePrRuns } from "@/lib/hooks/reviews";
import { VERDICT_META } from "../VerdictBanner/constants";
import { s } from "../VerdictBanner/styles";

/** The latest persisted `review`-kind record with a verdict — i.e. a
    completed run's outcome (kind: 'summary' rows have no verdict/findings). */
function latestCompletedReview(reviews: ReviewRecord[] | undefined): ReviewRecord | null {
  if (!reviews || reviews.length === 0) return null;
  const completed = reviews.filter((r) => r.kind === "review" && r.verdict != null);
  if (completed.length === 0) return null;
  return (
    [...completed].sort(
      (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime(),
    )[0] ?? null
  );
}

/** First finding of each severity, used to deep-link a SeverityChip to the
 *  Findings tab via the existing `?finding=` mechanism (opens + scrolls to
 *  the run/card containing it — see FindingsTab's targetFindingId wiring). */
function firstFindingBySeverity(findings: FindingRecord[]): Partial<Record<Severity, string>> {
  const out: Partial<Record<Severity, string>> = {};
  for (const f of findings) {
    if (!out[f.severity]) out[f.severity] = f.id;
  }
  return out;
}

export function ReviewRunOverview({ prId }: { prId: string | number | null }) {
  const t = useTranslations("prReview");
  const pathname = usePathname();
  const idStr = prId != null ? String(prId) : null;
  const { data: reviews } = usePrReviews(idStr);
  const { data: runs } = usePrRuns(idStr);

  const latest = latestCompletedReview(reviews);
  if (!latest) return null; // AC-23..26: no completed run yet — stay neutral (hidden).

  const counts = { CRITICAL: 0, WARNING: 0, SUGGESTION: 0 };
  for (const f of latest.findings) {
    if (f.severity in counts) counts[f.severity as keyof typeof counts] += 1;
  }
  const blockers = counts.CRITICAL;
  const firstBySeverity = firstFindingBySeverity(latest.findings);

  // Cost sum: total spend across every settled run for this PR (deliberately
  // no token counts surfaced here — see module comment).
  const costSum = (runs ?? []).reduce((sum, r) => sum + (r.cost_usd ?? 0), 0);
  const hasCost = (runs ?? []).some((r) => r.cost_usd != null);

  const m = latest.verdict ? VERDICT_META[latest.verdict] : VERDICT_META.comment;
  const VIcon = Icon[m.icon];

  return (
    <div style={s.wrap}>
      <div style={s.iconBox(m.bg, m.c)}>
        <VIcon size={22} />
      </div>
      <div style={s.main}>
        <div style={s.titleRow}>
          <span style={s.label(m.c)}>{t(`verdict.${m.labelKey}`)}</span>
          {blockers > 0 && (
            <span style={{ fontSize: 13, color: "var(--text-muted)" }}>
              {t("verdict.blockers", { count: blockers }).trim()}
            </span>
          )}
        </div>
        {latest.summary && <p style={s.summary}>{latest.summary}</p>}
        <div style={{ display: "flex", alignItems: "flex-end", gap: 14, marginTop: 10 }}>
          {([Severity.enum.CRITICAL, Severity.enum.WARNING, Severity.enum.SUGGESTION] as const).map((sev) => {
            const count = counts[sev];
            if (count <= 0) return null;
            const findingId = firstBySeverity[sev];
            const chip = <SeverityChip sev={sev} count={count} />;
            if (!findingId) return <span key={sev}>{chip}</span>;
            return (
              <Link
                key={sev}
                href={`${pathname}?tab=findings&finding=${encodeURIComponent(findingId)}`}
                style={{ textDecoration: "none" }}
                aria-label={t("overview.viewFindings", { severity: sev })}
              >
                {chip}
              </Link>
            );
          })}
        </div>
        {hasCost && (
          <span className="mono" style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 8, display: "inline-block" }}>
            {t("overview.costSum", { cost: costSum.toFixed(3) })}
          </span>
        )}
      </div>
      {latest.score != null && (
        <div style={s.scoreCol}>
          <CircularScore score={latest.score} size={52} stroke={5} />
          <span style={s.scoreLabel}>{t("verdict.prScore")}</span>
        </div>
      )}
    </div>
  );
}
