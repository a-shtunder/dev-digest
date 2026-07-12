"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { EmptyState, ErrorState, Skeleton } from "@devdigest/ui";
import { AppShell } from "@/components/app-shell";
import { useProjectContext } from "@/lib/hooks";
import { DocumentDrawer, type DrawerMode } from "../DocumentDrawer/DocumentDrawer";
import { DocumentRow } from "./DocumentRow";
import { relativeTimeAgo } from "./helpers";

interface DrawerState {
  path: string;
  mode: DrawerMode;
}

/** Project Context page body — discovery list, summary footer, and the
    Preview/Edit drawer. Renders the not-available state when the repo has
    no clone available (AC-5). */
export function ProjectContextView({ repoId }: { repoId: string }) {
  const t = useTranslations("projectContext");
  const { data, isLoading, isError, refetch } = useProjectContext(repoId);
  const [drawer, setDrawer] = React.useState<DrawerState | null>(null);

  const crumb = [{ label: t("page.crumbLabel") }, { label: t("page.crumb") }];

  return (
    <AppShell crumb={crumb}>
      <div style={{ padding: 28, maxWidth: 900 }}>
        <h1 style={{ fontSize: 22, fontWeight: 700, marginBottom: 20 }}>
          {t("page.heading")}
        </h1>

        {isLoading ? (
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            <Skeleton height={64} />
            <Skeleton height={64} />
            <Skeleton height={64} />
          </div>
        ) : isError ? (
          <ErrorState body={t("page.loadError")} onRetry={() => refetch()} />
        ) : !data?.summary.clone_available ? (
          <EmptyState
            icon="GitBranch"
            title={t("notAvailablePage.title")}
            body={t("notAvailablePage.body")}
          />
        ) : data.documents.length === 0 ? (
          <EmptyState icon="FileText" title={t("emptyPage.title")} body={t("emptyPage.body")} />
        ) : (
          <>
            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              {data.documents.map((doc) => (
                <DocumentRow
                  key={doc.path}
                  doc={doc}
                  onPreview={() => setDrawer({ path: doc.path, mode: "preview" })}
                />
              ))}
            </div>

            <div
              style={{
                marginTop: 16,
                display: "flex",
                alignItems: "center",
                gap: 6,
                fontSize: 13,
                color: "var(--text-secondary)",
              }}
            >
              <span aria-hidden="true">●</span>
              {t("page.footer", {
                count: data.summary.document_count,
                tokens: data.summary.total_estimated_tokens,
                relative: relativeTimeAgo(data.summary.refreshed_at),
              })}
            </div>
          </>
        )}
      </div>

      {drawer && (
        <DocumentDrawer
          repoId={repoId}
          path={drawer.path}
          initialMode={drawer.mode}
          onClose={() => setDrawer(null)}
        />
      )}
    </AppShell>
  );
}
