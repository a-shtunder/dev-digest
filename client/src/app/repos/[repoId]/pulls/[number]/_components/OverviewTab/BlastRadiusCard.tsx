/* BlastRadiusCard.tsx — "Blast Radius" card for the PR Overview tab: answers
   "what could this break?" from the repo-intel index (symbols/callers/
   endpoints), zero LLM calls. Mirrors IntentCard.tsx's structure: inline
   style objects, Card + SectionLabel, loading skeleton / minimal error text /
   populated body. */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Card, SectionLabel, Skeleton, EmptyState, Badge, Chip, Icon, type IconName } from "@devdigest/ui";
import { useBlastRadius } from "@/lib/hooks/blast";
import { groupCallersBySymbol } from "./blastViewModel";
import { BlastTree } from "./BlastTree";
import { BlastGraph } from "./BlastGraph";

type BlastView = "tree" | "graph";

export function BlastRadiusCard({
  prId,
  repoFullName,
  headSha,
}: {
  prId: string;
  repoFullName: string | null;
  headSha: string | null;
}) {
  const t = useTranslations("blast");
  const { data, isLoading, isError } = useBlastRadius(prId);
  const [view, setView] = React.useState<BlastView>("tree");

  return (
    <Card pad style={{ marginBottom: 0 }}>
      <SectionLabel icon="GitBranch">{t("sectionLabel")}</SectionLabel>

      {isLoading && (
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          <Skeleton height={16} width="80%" />
          <Skeleton height={14} width="60%" />
          <Skeleton height={14} width="70%" />
        </div>
      )}

      {isError && !isLoading && (
        <p style={{ fontSize: 13, color: "var(--text-muted)", margin: 0 }}>{t("empty.title")}</p>
      )}

      {!isLoading && !isError && data && (
        <BlastRadiusBody data={data} view={view} onViewChange={setView} repoFullName={repoFullName} headSha={headSha} />
      )}
    </Card>
  );
}

function BlastRadiusBody({
  data,
  view,
  onViewChange,
  repoFullName,
  headSha,
}: {
  data: NonNullable<ReturnType<typeof useBlastRadius>["data"]>;
  view: BlastView;
  onViewChange: (v: BlastView) => void;
  repoFullName: string | null;
  headSha: string | null;
}) {
  const t = useTranslations("blast");

  const isEmpty = data.changedSymbols.length === 0 && data.callers.length === 0;

  // Degraded + empty must still surface the degraded reason copy — it's the
  // whole point of those strings (e.g. repo not indexed yet, flag off).
  if (isEmpty && data.degraded) {
    return (
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <Badge dot color="var(--warn)">
            {t("degraded.badge")}
          </Badge>
          {data.reason && (
            <span style={{ fontSize: 12, color: "var(--text-muted)" }}>
              {t(`degraded.reason.${data.reason}`)}
            </span>
          )}
        </div>
        <p style={{ fontSize: 13, color: "var(--text-muted)", margin: 0 }}>{t("empty.body")}</p>
      </div>
    );
  }

  if (isEmpty) {
    return <EmptyState icon="GitBranch" title={t("empty.title")} body={t("empty.body")} />;
  }

  const cronSet = new Set<string>();
  if (data.factsByFile) {
    for (const facts of Object.values(data.factsByFile)) {
      for (const cron of facts.crons) cronSet.add(cron);
    }
  }
  const crons = Array.from(cronSet);
  // Only symbols with actual downstream impact are worth showing in the
  // Tree/Graph body — a PR can touch 100+ symbols (types, trivial helpers)
  // where only a couple have real callers. The stat row below still reports
  // the TRUE total (data.changedSymbols.length), so the two numbers can
  // legitimately differ — that's intentional, not a bug.
  const groups = groupCallersBySymbol(data.changedSymbols, data.callers, data.factsByFile);
  const callerGroups = groups.filter((g) => g.callers.length > 0);
  const hasCallers = data.callers.length > 0;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      {data.degraded && (
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <Badge dot color="var(--warn)">
            {t("degraded.badge")}
          </Badge>
          {data.reason && (
            <span style={{ fontSize: 12, color: "var(--text-muted)" }}>
              {t(`degraded.reason.${data.reason}`)}
            </span>
          )}
        </div>
      )}

      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          flexWrap: "wrap",
          gap: 12,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 14, flexWrap: "wrap" }}>
          <StatInline icon="Code" count={data.changedSymbols.length} label={t("stat.symbols")} />
          <StatInline icon="CornerDownRight" count={data.callers.length} label={t("stat.callers")} />
          <StatInline icon="Globe" count={data.impactedEndpoints.length} label={t("stat.endpoints")} />
          <StatInline icon="Clock" count={crons.length} label={t("stat.crons")} />
        </div>

        <div style={{ display: "flex", gap: 8 }}>
          <Chip active={view === "tree"} onClick={() => onViewChange("tree")}>
            {t("view.tree")}
          </Chip>
          <Chip active={view === "graph"} onClick={() => onViewChange("graph")}>
            {t("view.graph")}
          </Chip>
        </div>
      </div>

      {!hasCallers && (
        <p style={{ fontSize: 13, color: "var(--text-muted)", margin: 0 }}>
          {t("noDownstream", { count: data.changedSymbols.length })}
        </p>
      )}

      {hasCallers && view === "tree" && (
        <BlastTree groups={callerGroups} repoFullName={repoFullName} headSha={headSha} />
      )}

      {hasCallers && view === "graph" && (
        callerGroups.length > 0 ? (
          <BlastGraph groups={callerGroups} />
        ) : (
          <p style={{ fontSize: 13, color: "var(--text-muted)", margin: 0 }}>{t("graph.empty")}</p>
        )
      )}

      <p style={{ fontSize: 12, color: "var(--text-muted)", margin: 0 }}>{t("priorPrs.stub")}</p>
    </div>
  );
}

/** Compact inline stat: small icon + "N label" (e.g. "2 symbols"), matching
    the approved design's single-row layout — not big stacked KPI tiles. */
function StatInline({ icon, count, label }: { icon: IconName; count: number; label: string }) {
  const I = Icon[icon];
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 5,
        fontSize: 12.5,
        color: "var(--text-secondary)",
        whiteSpace: "nowrap",
      }}
    >
      <I size={13} style={{ color: "var(--text-muted)", flexShrink: 0 }} />
      <span className="tnum" style={{ fontWeight: 600, color: "var(--text-primary)" }}>
        {count}
      </span>
      {label}
    </span>
  );
}
