/* Conventions — /repos/:repoId/conventions (L02, Conventions Extractor).
   Scans the cloned repo for house code-style conventions (POST .../extract),
   lists candidates with real code evidence, lets the user accept/reject, and
   merges the accepted set into one skill via the Create-skill modal. */
"use client";

import React from "react";
import { useParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { Button, Skeleton, EmptyState, ErrorState } from "@devdigest/ui";
import { AppShell } from "@/components/app-shell";
import { RepoNotFound } from "@/components/repo-not-found";
import { useActiveRepo, useRepoNotFound } from "@/lib/repo-context";
import { ApiError } from "@/lib/api";
import {
  useConventions,
  useExtractConventions,
  useAcceptConvention,
  useDeselectConvention,
  useDeleteConvention,
  useUpdateConvention,
} from "@/lib/hooks/conventions";
import { ConventionCard } from "./_components/ConventionCard";
import { CreateSkillModal } from "./_components/CreateSkillModal";

export default function ConventionsPage() {
  const t = useTranslations("conventions");
  const params = useParams<{ repoId: string }>();
  const repoId = params.repoId;
  const { activeRepo } = useActiveRepo();
  const repoNotFound = useRepoNotFound(repoId);

  const { data: candidates, isLoading, isError, error, refetch } = useConventions(repoId);
  const extract = useExtractConventions(repoId);
  const accept = useAcceptConvention(repoId);
  const deselect = useDeselectConvention(repoId);
  const remove = useDeleteConvention(repoId);
  const updateRule = useUpdateConvention(repoId);
  const [modalOpen, setModalOpen] = React.useState(false);

  const repoName = activeRepo?.full_name ?? t("page.repoFallback");
  const list = candidates ?? [];
  const accepted = list.filter((c) => c.accepted);
  const busy = accept.isPending || deselect.isPending || remove.isPending;

  const crumb = [{ label: t("page.crumbLab") }, { label: t("page.crumbConventions") }];

  if (repoNotFound) {
    return (
      <AppShell crumb={crumb}>
        <RepoNotFound />
      </AppShell>
    );
  }

  const rescanButton = (
    <Button
      kind="secondary"
      icon="RefreshCw"
      onClick={() => extract.mutate()}
      loading={extract.isPending}
      disabled={extract.isPending}
    >
      {extract.isPending
        ? t("page.scanning")
        : list.length > 0
          ? t("page.rescan")
          : t("page.runExtraction")}
    </Button>
  );

  return (
    <AppShell crumb={crumb}>
      <div style={{ maxWidth: 1120, margin: "0 auto" }}>
      <div style={{ display: "flex", alignItems: "flex-start", marginBottom: 20 }}>
        <div style={{ flex: 1 }}>
          <h1 style={{ fontSize: 22, fontWeight: 700 }}>
            {t("page.headingPrefix")}
            <span className="mono" style={{ color: "var(--accent-text)" }}>
              {repoName}
            </span>
          </h1>
          <p style={{ fontSize: 13.5, color: "var(--text-muted)", marginTop: 4 }}>
            {extract.isPending
              ? t("page.scanningHint")
              : list.length > 0
                ? t("page.candidateCount", { count: list.length })
                : t("page.subtitle")}
          </p>
        </div>
        {rescanButton}
      </div>

      {extract.isError && (
        <p style={{ fontSize: 13, color: "var(--crit)", marginBottom: 16 }}>
          {t("page.extractionFailed")}
          {extract.error instanceof ApiError ? `: ${extract.error.message}` : ""}
        </p>
      )}

      {isLoading ? (
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} height={160} />
          ))}
        </div>
      ) : isError ? (
        <ErrorState
          title={t("page.loadError")}
          body={error instanceof ApiError ? error.message : ""}
          onRetry={() => refetch()}
        />
      ) : list.length === 0 ? (
        <EmptyState
          icon="ListChecks"
          title={t("page.empty.title")}
          body={t("page.empty.body")}
          cta={t("page.empty.cta")}
          onCta={() => extract.mutate()}
          ctaLoading={extract.isPending}
        />
      ) : (
        <>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 14,
              marginBottom: 18,
              padding: "12px 16px",
              background: "var(--bg-surface)",
              border: "1px solid var(--border)",
              borderRadius: 10,
            }}
          >
            <Button
              kind="ghost"
              size="sm"
              icon="X"
              onClick={() => accepted.forEach((c) => deselect.mutate(c.id))}
              disabled={busy || accepted.length === 0}
            >
              {t("toolbar.deselectAll")}
            </Button>
            <span
              className="tnum"
              style={{ fontSize: 13, color: "var(--text-secondary)", fontWeight: 500 }}
            >
              {t("toolbar.accepted", { accepted: accepted.length, total: list.length })}
            </span>
            <Button
              kind="primary"
              icon="Sparkles"
              onClick={() => setModalOpen(true)}
              disabled={accepted.length === 0}
              style={{ marginLeft: "auto" }}
            >
              {t("toolbar.createSkill")}
            </Button>
          </div>

          <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
            {list.map((c) => (
              <ConventionCard
                key={c.id}
                candidate={c}
                busy={busy}
                onAccept={() => (c.accepted ? deselect : accept).mutate(c.id)}
                onReject={() => remove.mutate(c.id)}
                onSaveRule={(rule) => updateRule.mutate({ id: c.id, rule })}
              />
            ))}
          </div>
        </>
      )}

      {modalOpen && (
        <CreateSkillModal
          repoFullName={repoName}
          accepted={accepted}
          onClose={() => setModalOpen(false)}
        />
      )}
      </div>
    </AppShell>
  );
}
