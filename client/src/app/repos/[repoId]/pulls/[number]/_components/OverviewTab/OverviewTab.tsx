"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { SectionLabel } from "@devdigest/ui";
import { s } from "./styles";
import { IntentCard } from "./IntentCard";
import { BlastRadiusCard } from "./BlastRadiusCard";
import { PrBriefCard } from "../PrBriefCard/PrBriefCard";
import { ReviewRunOverview } from "../ReviewRunOverview/ReviewRunOverview";
import { ReviewFocusCard } from "../ReviewFocusCard/ReviewFocusCard";

interface OverviewTabProps {
  prBody: string | null | undefined;
  prId: string | null;
  repoFullName: string | null;
  headSha: string | null;
}

export function OverviewTab({ prBody, prId, repoFullName, headSha }: OverviewTabProps) {
  const t = useTranslations("prReview");
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
      {prId && (
        <>
          {/* Full-width verdict block at the top, matching the PR-brief design. */}
          <ReviewRunOverview prId={prId} />

          <div style={{ display: "flex", gap: 20, alignItems: "flex-start" }}>
            <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: 20 }}>
              <PrBriefCard prId={prId} />
            </div>
            <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: 20 }}>
              <IntentCard prId={prId} />
              <BlastRadiusCard prId={prId} repoFullName={repoFullName} headSha={headSha} />
            </div>
          </div>

          {/* Full-width, titled — its own section, not nested inside PrBriefCard. */}
          <ReviewFocusCard prId={prId} />
        </>
      )}
      {prBody && (
        <section>
          <SectionLabel icon="MessageSquare">{t("overview.descriptionLabel")}</SectionLabel>
          <div style={s.descriptionBox}>{prBody}</div>
        </section>
      )}
    </div>
  );
}
