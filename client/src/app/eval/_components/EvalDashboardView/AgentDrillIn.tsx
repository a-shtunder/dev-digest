/* AgentDrillIn — large metric cards + trend chart for one agent's eval
   dashboard, plus a recent-runs table. Selecting exactly two runs enables
   "Compare selected", which opens the T14 CompareRuns modal. */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Button, Icon, LineChart, MetricCard, Skeleton, ErrorState } from "@devdigest/ui";
import type { EvalRunRecord } from "@devdigest/shared";
import { useEvalAgentDashboard, useRunEvalSet } from "@/lib/hooks/eval";
import { CompareRuns } from "../CompareRuns";
import { formatPercent, formatRunDate, toggleRunSelection, trendSeries } from "./helpers";
import { s } from "./styles";

export function AgentDrillIn({
  agentId,
  agentName,
  onBack,
  initialHighlightRunId,
}: {
  agentId: string;
  agentName: string;
  onBack: () => void;
  /** Set when arriving here by clicking a run row in the workspace-wide
   *  recent-runs table — scrolls that row into view and highlights it once. */
  initialHighlightRunId?: string | null;
}) {
  const t = useTranslations("eval");
  const { data, isLoading, isError, refetch } = useEvalAgentDashboard(agentId);
  const runSet = useRunEvalSet();
  const [selected, setSelected] = React.useState<string[]>([]);
  const [comparing, setComparing] = React.useState(false);
  const [highlightedRunId, setHighlightedRunId] = React.useState<string | null>(
    initialHighlightRunId ?? null,
  );
  const rowRefs = React.useRef(new Map<string, HTMLTableRowElement>());

  React.useEffect(() => {
    if (!initialHighlightRunId) return;
    // jsdom doesn't implement scrollIntoView — guard so tests don't crash.
    rowRefs.current.get(initialHighlightRunId)?.scrollIntoView?.({ behavior: "smooth", block: "center" });
  }, [initialHighlightRunId, data?.recent_runs]);

  const runsById = React.useMemo(() => {
    const map = new Map<string, EvalRunRecord>();
    (data?.recent_runs ?? []).forEach((r) => map.set(r.id, r));
    return map;
  }, [data?.recent_runs]);

  const selectedRuns = selected
    .map((id) => runsById.get(id))
    .filter((r): r is EvalRunRecord => !!r);

  return (
    <div>
      <div style={s.drillHeader}>
        <Button kind="ghost" icon="ChevronLeft" onClick={onBack}>
          {t("dashboard.back")}
        </Button>
        <h2 style={s.h1}>{agentName}</h2>
        <div style={{ marginLeft: "auto" }}>
          <Button
            kind="primary"
            icon="Play"
            loading={runSet.isPending}
            onClick={() => runSet.mutate(agentId)}
          >
            {runSet.isPending ? t("dashboard.runningSet") : t("dashboard.runSet")}
          </Button>
        </div>
      </div>

      {isLoading && (
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          <Skeleton height={100} />
          <Skeleton height={200} />
        </div>
      )}

      {isError && <ErrorState body={t("dashboard.loading")} onRetry={() => refetch()} />}

      {data && (
        <>
          <div style={s.metricsGrid}>
            <MetricCard
              label={t("dashboard.metrics.recall")}
              value={formatPercent(data.current.recall)}
              delta={data.delta.recall}
              trend={trendSeries(data.trend, "recall")}
            />
            <MetricCard
              label={t("dashboard.metrics.precision")}
              value={formatPercent(data.current.precision)}
              delta={data.delta.precision}
              trend={trendSeries(data.trend, "precision")}
            />
            <MetricCard
              label={t("dashboard.metrics.citationAccuracy")}
              value={formatPercent(data.current.citation_accuracy)}
              delta={data.delta.citation_accuracy}
              trend={trendSeries(data.trend, "citation_accuracy")}
            />
          </div>

          {data.trend.length > 0 && (
            <div style={s.chartWrap}>
              <div style={s.sectionTitle}>{t("dashboard.metricTrend")}</div>
              <LineChart
                series={[
                  { name: t("dashboard.legend.recall"), color: "var(--accent)", data: trendSeries(data.trend, "recall") },
                  { name: t("dashboard.legend.precision"), color: "var(--ok)", data: trendSeries(data.trend, "precision") },
                  { name: t("dashboard.legend.citation"), color: "var(--warn)", data: trendSeries(data.trend, "citation_accuracy") },
                ]}
              />
            </div>
          )}

          <div style={s.sectionTitle}>{t("dashboard.recentRuns")}</div>
          {data.recent_runs.length === 0 ? (
            <div role="status" style={s.cardEmpty}>
              {t("dashboard.noRuns")}
            </div>
          ) : (
            <>
              <div style={s.compareBar}>
                <span>{t("dashboard.selectTwoToCompare")}</span>
                <Button
                  kind="secondary"
                  size="sm"
                  disabled={selectedRuns.length !== 2}
                  onClick={() => {
                    /* opens the compare modal below via `comparing` state */
                    setComparing(true);
                  }}
                >
                  {t("dashboard.compareSelected")}
                </Button>
              </div>
              <table style={s.table}>
                <thead>
                  <tr>
                    <th style={s.th} />
                    <th style={s.th}>{t("dashboard.table.ranAt")}</th>
                    <th style={s.th}>{t("dashboard.table.recall")}</th>
                    <th style={s.th}>{t("dashboard.table.precision")}</th>
                    <th style={s.th}>{t("dashboard.table.citation")}</th>
                    <th style={s.th}>{t("dashboard.table.pass")}</th>
                    <th style={s.th}>{t("dashboard.table.cost")}</th>
                  </tr>
                </thead>
                <tbody>
                  {data.recent_runs.map((run) => (
                    <tr
                      key={run.id}
                      ref={(el) => {
                        if (el) rowRefs.current.set(run.id, el);
                        else rowRefs.current.delete(run.id);
                      }}
                      onClick={() => setHighlightedRunId(run.id)}
                      style={highlightedRunId === run.id ? s.trHighlighted : s.trClickable}
                    >
                      <td style={s.td} onClick={(e) => e.stopPropagation()}>
                        <input
                          type="checkbox"
                          checked={selected.includes(run.id)}
                          onChange={() => setSelected((prev) => toggleRunSelection(prev, run.id))}
                          aria-label={`${t("dashboard.compareSelected")} · ${formatRunDate(run.ran_at)}`}
                        />
                      </td>
                      <td style={s.td}>{formatRunDate(run.ran_at)}</td>
                      <td style={s.td}>{run.recall === null ? "—" : formatPercent(run.recall)}</td>
                      <td style={s.td}>{run.precision === null ? "—" : formatPercent(run.precision)}</td>
                      <td style={s.td}>
                        {run.citation_accuracy === null ? "—" : formatPercent(run.citation_accuracy)}
                      </td>
                      <td style={s.td}>
                        {run.pass === null ? (
                          "—"
                        ) : run.pass ? (
                          <span style={{ display: "inline-flex", alignItems: "center", gap: 4, color: "var(--ok)" }}>
                            <Icon.CheckCircle size={13} />
                            {t("dashboard.pass")}
                          </span>
                        ) : (
                          <span style={{ display: "inline-flex", alignItems: "center", gap: 4, color: "var(--crit)" }}>
                            <Icon.XCircle size={13} />
                            {t("dashboard.fail")}
                          </span>
                        )}
                      </td>
                      <td style={s.td}>{run.cost_usd == null ? "—" : `$${run.cost_usd.toFixed(3)}`}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </>
          )}
        </>
      )}

      {comparing && selectedRuns.length === 2 && (
        <CompareRuns
          agentId={agentId}
          runs={[selectedRuns[0]!, selectedRuns[1]!]}
          onClose={() => setComparing(false)}
        />
      )}
    </div>
  );
}
