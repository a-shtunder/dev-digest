/* EvalDashboardView — workspace-wide Eval Dashboard (T13, L06). Lists every
   review agent with RECALL / PRECISION / CITE + a recall sparkline and a
   recent-runs table (GET /eval/dashboard, T9). Selecting an agent drills in
   to large metric cards + a trend chart + a run-selection table that opens
   the T14 Compare modal. */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { EmptyState, ErrorState, Skeleton } from "@devdigest/ui";
import { AppShell } from "@/components/app-shell";
import { useEvalWorkspaceDashboard } from "@/lib/hooks/eval";
import { AgentSummaryCard } from "./AgentSummaryCard";
import { AgentDrillIn } from "./AgentDrillIn";
import { formatPercent, formatRunDate } from "./helpers";
import { s } from "./styles";

export function EvalDashboardView() {
  const t = useTranslations("eval");
  const { data, isLoading, isError, refetch } = useEvalWorkspaceDashboard();
  const [selectedAgentId, setSelectedAgentId] = React.useState<string | null>(null);
  const [highlightRunId, setHighlightRunId] = React.useState<string | null>(null);

  const selectedAgent = data?.agents.find((a) => a.agent_id === selectedAgentId) ?? null;

  const openRun = (runAgentId: string | null | undefined, runId: string) => {
    if (!runAgentId) return;
    setSelectedAgentId(runAgentId);
    setHighlightRunId(runId);
  };

  const crumb = [
    { label: t("page.crumbSkillsLab") },
    { label: t("page.crumbEvalDashboard") },
  ];

  return (
    <AppShell crumb={crumb}>
      <div style={s.page}>
        {selectedAgent ? (
          <AgentDrillIn
            agentId={selectedAgent.agent_id}
            agentName={selectedAgent.name}
            initialHighlightRunId={highlightRunId}
            onBack={() => {
              setSelectedAgentId(null);
              setHighlightRunId(null);
            }}
          />
        ) : (
          <>
            <div style={s.header}>
              <h1 style={s.h1}>{t("dashboard.defaultTitle")}</h1>
              <p style={s.subtitle}>{t("dashboard.overviewSubtitle")}</p>
            </div>

            {isLoading && (
              <div style={s.grid}>
                <Skeleton height={140} />
                <Skeleton height={140} />
                <Skeleton height={140} />
              </div>
            )}

            {isError && <ErrorState body={t("dashboard.loading")} onRetry={() => refetch()} />}

            {data && data.agents.length === 0 && (
              <EmptyState icon="Target" title={t("dashboard.noAgents")} />
            )}

            {data && data.agents.length > 0 && (
              <div style={s.grid}>
                {data.agents.map((agent) => (
                  <AgentSummaryCard
                    key={agent.agent_id}
                    agent={agent}
                    onClick={() => setSelectedAgentId(agent.agent_id)}
                  />
                ))}
              </div>
            )}

            {data && (
              <div>
                <div style={s.sectionTitle}>{t("dashboard.recentRuns")}</div>
                {data.recent_runs.length === 0 ? (
                  <div role="status" style={s.cardEmpty}>
                    {t("dashboard.noRuns")}
                  </div>
                ) : (
                  <table style={s.table}>
                    <thead>
                      <tr>
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
                          onClick={() => openRun(run.agent_id, run.id)}
                          style={run.agent_id ? s.trClickable : undefined}
                        >
                          <td style={s.td}>
                            {run.case_name ?? run.case_id} · {formatRunDate(run.ran_at)}
                          </td>
                          <td style={s.td}>{run.recall === null ? "—" : formatPercent(run.recall)}</td>
                          <td style={s.td}>{run.precision === null ? "—" : formatPercent(run.precision)}</td>
                          <td style={s.td}>
                            {run.citation_accuracy === null ? "—" : formatPercent(run.citation_accuracy)}
                          </td>
                          <td style={s.td}>
                            {run.pass === null ? "—" : run.pass ? t("dashboard.pass") : t("dashboard.fail")}
                          </td>
                          <td style={s.td}>{run.cost_usd == null ? "—" : `$${run.cost_usd.toFixed(3)}`}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>
            )}
          </>
        )}
      </div>
    </AppShell>
  );
}
