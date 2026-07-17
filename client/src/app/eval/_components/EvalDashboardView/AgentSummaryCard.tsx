/* AgentSummaryCard — one review agent's row in the workspace Eval Dashboard
   grid: RECALL / PRECISION / CITE as number + label (never colour alone),
   plus a Sparkline of the recall trend. An agent with zero runs renders a
   neutral empty state instead of metrics (AC-25). */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Card, Icon, Sparkline } from "@devdigest/ui";
import type { EvalAgentSummary } from "@devdigest/shared";
import { formatPercent, hasRuns, trendSeries } from "./helpers";
import { s } from "./styles";

export function AgentSummaryCard({
  agent,
  onClick,
}: {
  agent: EvalAgentSummary;
  onClick: () => void;
}) {
  const t = useTranslations("eval");
  const withRuns = hasRuns(agent);

  return (
    <Card hover onClick={onClick} style={s.card}>
      <div style={s.cardHeader}>
        <span style={s.cardTitle}>{agent.name}</span>
        {withRuns ? (
          <span style={s.cardFooter}>
            {t("dashboard.tracesSummary", {
              passed: agent.traces_passed,
              total: agent.traces_total,
            })}
          </span>
        ) : (
          <span role="status" style={s.cardFooter}>
            {t("dashboard.agentEmptyRuns")}
          </span>
        )}
      </div>

      {withRuns && (
        <>
          <Sparkline data={trendSeries(agent.trend, "recall")} color="var(--accent)" w={64} h={22} />
          <div style={s.cardMetrics}>
            <div style={s.cardMetric}>
              <span style={s.cardMetricLabel}>{t("dashboard.metrics.recall")}</span>
              <span className="tnum" style={s.cardMetricValue}>
                {formatPercent(agent.recall)}
              </span>
            </div>
            <div style={s.cardMetric}>
              <span style={s.cardMetricLabel}>{t("dashboard.metrics.precision")}</span>
              <span className="tnum" style={s.cardMetricValue}>
                {formatPercent(agent.precision)}
              </span>
            </div>
            <div style={s.cardMetric}>
              <span style={s.cardMetricLabel}>{t("dashboard.metrics.citationAccuracy")}</span>
              <span className="tnum" style={s.cardMetricValue}>
                {formatPercent(agent.citation_accuracy)}
              </span>
            </div>
          </div>
        </>
      )}

      <Icon.ChevronRight size={16} style={s.cardChevron} />
    </Card>
  );
}
