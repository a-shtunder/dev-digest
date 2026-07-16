/* EvalsTab — per-agent regression eval cases: metric cards (recall/precision/
   citation, conveyed as number + label — never colour alone), the case list
   with per-case pass/fail (text/icon, not colour alone), and "Run all evals"
   / "New eval case" actions. Opens EvalCaseEditor for new/edit. Modeled on
   SkillsTab's structure. */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Button, Icon, Skeleton, ErrorState } from "@devdigest/ui";
import type { EvalCase, EvalRunRecord } from "@devdigest/shared";
import {
  useEvalCases,
  useEvalAgentDashboard,
  useRunEvalSet,
  useRunEvalCase,
  useDeleteEvalCase,
} from "@/lib/hooks/eval";
import { EvalCaseEditor } from "../EvalCaseEditor/EvalCaseEditor";

function formatPct(n: number | undefined): string {
  return `${Math.round((n ?? 0) * 100)}%`;
}

function MetricCard({ label, value }: { label: string; value: number | undefined }) {
  return (
    <div
      style={{
        flex: 1,
        padding: "14px 16px",
        borderRadius: 8,
        border: "1px solid var(--border)",
        background: "var(--bg-elevated)",
      }}
    >
      <div style={{ fontSize: 22, fontWeight: 700 }}>{formatPct(value)}</div>
      <div
        style={{
          fontSize: 11,
          fontWeight: 600,
          letterSpacing: 0.4,
          color: "var(--text-muted)",
          marginTop: 2,
        }}
      >
        {label}
      </div>
    </div>
  );
}

export function EvalsTab({
  agentId,
  agentName,
}: {
  agentId: string;
  agentName: string;
}) {
  const t = useTranslations("eval.evalsTab");
  const tMetrics = useTranslations("eval.dashboard.metrics");

  const {
    data: cases,
    isLoading: casesLoading,
    isError: casesError,
    refetch,
  } = useEvalCases(agentId);
  const { data: dashboard } = useEvalAgentDashboard(agentId);
  const runSet = useRunEvalSet();
  const runCase = useRunEvalCase();
  const deleteCase = useDeleteEvalCase();

  const [editor, setEditor] = React.useState<{
    open: boolean;
    evalCase: EvalCase | null;
  }>({ open: false, evalCase: null });

  // Latest run per case, keyed off the agent dashboard's recent_runs feed.
  const latestRunByCase = React.useMemo(() => {
    const map = new Map<string, EvalRunRecord>();
    for (const run of dashboard?.recent_runs ?? []) {
      if (!map.has(run.case_id)) map.set(run.case_id, run);
    }
    return map;
  }, [dashboard]);

  const openNewCase = () => setEditor({ open: true, evalCase: null });
  const openEditCase = (evalCase: EvalCase) =>
    setEditor({ open: true, evalCase });
  const closeEditor = () => setEditor({ open: false, evalCase: null });

  if (casesLoading) {
    return (
      <div
        style={{ padding: 28, display: "flex", flexDirection: "column", gap: 12 }}
      >
        <Skeleton height={48} />
        <Skeleton height={48} />
        <Skeleton height={48} />
      </div>
    );
  }

  if (casesError) {
    return (
      <ErrorState body={t("emptyCases")} onRetry={() => refetch()} />
    );
  }

  const list = cases ?? [];

  return (
    <div style={{ padding: 28, maxWidth: 780 }}>
      {/* Metric cards */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 12,
          marginBottom: 6,
        }}
      >
        <h2 style={{ fontSize: 15, fontWeight: 700, flex: 1 }}>
          {t("metricsTitle")}
        </h2>
        <Button
          kind="primary"
          size="sm"
          icon="Play"
          loading={runSet.isPending}
          disabled={runSet.isPending || list.length === 0}
          onClick={() => runSet.mutate(agentId)}
        >
          {runSet.isPending ? t("runningAll") : t("runAll")}
        </Button>
      </div>
      <p style={{ fontSize: 12, color: "var(--text-muted)", marginBottom: 16 }}>
        {t("metricsSubtitle")}
      </p>
      <div style={{ display: "flex", gap: 10, marginBottom: 24 }}>
        <MetricCard label={tMetrics("recall")} value={dashboard?.current.recall} />
        <MetricCard
          label={tMetrics("precision")}
          value={dashboard?.current.precision}
        />
        <MetricCard
          label={tMetrics("citationAccuracy")}
          value={dashboard?.current.citation_accuracy}
        />
      </div>

      {/* Case list */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 12,
          marginBottom: 12,
        }}
      >
        <h2 style={{ fontSize: 15, fontWeight: 700, flex: 1 }}>
          {t("casesHeading")}
        </h2>
        <Button kind="secondary" size="sm" icon="Plus" onClick={openNewCase}>
          {t("newCase")}
        </Button>
      </div>

      {list.length === 0 ? (
        <p
          style={{
            fontSize: 13,
            color: "var(--text-muted)",
            textAlign: "center",
            padding: 24,
            border: "1px dashed var(--border)",
            borderRadius: 8,
          }}
        >
          {t("emptyCases")}
        </p>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          {list.map((evalCase) => {
            const run = latestRunByCase.get(evalCase.id);
            const status = run == null ? "never" : run.pass ? "pass" : "fail";
            const statusLabel =
              status === "never"
                ? t("neverRun")
                : status === "pass"
                  ? t("passed")
                  : t("failed");
            const recallSuffix =
              run?.recall != null
                ? t("recallSuffix", { recall: Math.round(run.recall * 100) })
                : "";

            return (
              <div
                key={evalCase.id}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 10,
                  padding: "10px 12px",
                  borderRadius: 8,
                  border: "1px solid var(--border)",
                  background: "var(--bg-elevated)",
                }}
              >
                {/* Status: icon + text — never colour alone */}
                <span
                  role="status"
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 6,
                    fontSize: 12,
                    fontWeight: 600,
                    color:
                      status === "pass"
                        ? "var(--ok, #16a34a)"
                        : status === "fail"
                          ? "var(--crit)"
                          : "var(--text-muted)",
                    flexShrink: 0,
                    minWidth: 96,
                  }}
                >
                  {status === "pass" && <Icon.CheckCircle size={14} />}
                  {status === "fail" && <Icon.XCircle size={14} />}
                  {statusLabel}
                  {recallSuffix}
                </span>

                <span
                  style={{
                    fontWeight: 600,
                    fontSize: 13,
                    flex: 1,
                    minWidth: 0,
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                  }}
                >
                  {evalCase.name}
                </span>

                <Button
                  kind="ghost"
                  size="sm"
                  icon="Play"
                  aria-label={
                    runCase.isPending && runCase.variables === evalCase.id
                      ? t("running")
                      : t("run")
                  }
                  title={
                    runCase.isPending && runCase.variables === evalCase.id
                      ? t("running")
                      : t("run")
                  }
                  loading={
                    runCase.isPending && runCase.variables === evalCase.id
                  }
                  disabled={runCase.isPending}
                  onClick={() => runCase.mutate(evalCase.id)}
                />
                <Button
                  kind="ghost"
                  size="sm"
                  icon="Edit"
                  aria-label={t("edit")}
                  title={t("edit")}
                  onClick={() => openEditCase(evalCase)}
                />
                <Button
                  kind="ghost"
                  size="sm"
                  icon="Trash"
                  aria-label={t("delete")}
                  title={t("delete")}
                  loading={
                    deleteCase.isPending && deleteCase.variables?.id === evalCase.id
                  }
                  disabled={deleteCase.isPending}
                  onClick={() => {
                    if (
                      window.confirm(
                        `Delete eval case "${evalCase.name}"? This cannot be undone.`,
                      )
                    ) {
                      deleteCase.mutate({ id: evalCase.id, agentId });
                    }
                  }}
                />
              </div>
            );
          })}
        </div>
      )}

      {editor.open && (
        <EvalCaseEditor
          agentId={agentId}
          agentName={agentName}
          evalCase={editor.evalCase}
          onClose={closeEditor}
          onSaved={() => refetch()}
        />
      )}
    </div>
  );
}
