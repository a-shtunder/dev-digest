/* PrBriefCard — condensed "why + risk" summary for a PR (What / Why / Risk
   level / Risks). Lazily generated server-side; this card handles the empty
   (Generate CTA, AC-12), loading, error+Retry (AC-18 / AC-7 US-7), and
   loaded (AC-20, AC-22) states. The "review focus" list (AC-21) is rendered
   by the sibling `ReviewFocusCard` as its own full-width, titled card — see
   that file for the line-anchor mechanism, shared with this card's risk
   `file_refs` via `fileRef.tsx`. */
"use client";

import React from "react";
import { usePathname } from "next/navigation";
import { useTranslations } from "next-intl";
import { Card, SectionLabel, Button, Skeleton, Badge, Icon } from "@devdigest/ui";
import { useBrief, useGenerateBrief } from "@/lib/hooks/brief";
import type { RiskSeverity } from "@devdigest/shared";
import { FileRefLink } from "./fileRef";

const RISK_META: Record<string, { color: string; bg: string }> = {
  low: { color: "var(--ok)", bg: "var(--ok-bg)" },
  medium: { color: "var(--warn)", bg: "var(--warn-bg)" },
  high: { color: "var(--crit)", bg: "var(--crit-bg)" },
  critical: { color: "var(--crit)", bg: "var(--crit-bg)" },
};

export function PrBriefCard({ prId }: { prId: string | number | null }) {
  const t = useTranslations("brief-card");
  const pathname = usePathname();
  const { data, isLoading, isError, refetch } = useBrief(prId);
  const generate = useGenerateBrief(prId);

  const brief = data?.brief;

  return (
    <Card pad style={{ marginBottom: 0 }}>
      <SectionLabel
        icon="Sparkles"
        right={
          <Badge color="var(--accent-text)" bg="var(--accent-bg)" icon="Sparkles">
            {t("aiGenerated")}
          </Badge>
        }
      >
        {t("whatLabel")} / {t("whyLabel")}
      </SectionLabel>

      {isLoading && (
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          <Skeleton height={16} width="80%" />
          <Skeleton height={14} width="60%" />
          <Skeleton height={14} width="70%" />
        </div>
      )}

      {isError && !isLoading && (
        <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-start", gap: 10 }}>
          <p style={{ fontSize: 13, color: "var(--text-muted)", margin: 0 }}>{t("error")}</p>
          <Button kind="secondary" size="sm" icon="RefreshCw" onClick={() => refetch()}>
            {t("retry")}
          </Button>
        </div>
      )}

      {!isLoading && !isError && !brief && (
        <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-start", gap: 10 }}>
          <p style={{ fontSize: 13, color: "var(--text-muted)", margin: 0 }}>{t("empty")}</p>
          <Button
            kind="primary"
            size="sm"
            icon="Sparkles"
            loading={generate.isPending}
            onClick={() => generate.mutate()}
          >
            {t("generate")}
          </Button>
        </div>
      )}

      {!isLoading && !isError && brief && (
        <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          <div>
            <p
              style={{
                fontSize: 11,
                fontWeight: 700,
                letterSpacing: "0.06em",
                textTransform: "uppercase",
                color: "var(--text-muted)",
                margin: "0 0 4px 0",
              }}
            >
              {t("whatLabel")}
            </p>
            <p style={{ fontSize: 14, color: "var(--text-primary)", margin: 0, lineHeight: 1.6 }}>
              {brief.what}
            </p>
          </div>

          <div>
            <p
              style={{
                fontSize: 11,
                fontWeight: 700,
                letterSpacing: "0.06em",
                textTransform: "uppercase",
                color: "var(--text-muted)",
                margin: "0 0 4px 0",
              }}
            >
              {t("whyLabel")}
            </p>
            <p style={{ fontSize: 14, color: "var(--text-secondary)", margin: 0, lineHeight: 1.6 }}>
              {brief.why}
            </p>
          </div>

          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <span
              style={{
                fontSize: 11,
                fontWeight: 700,
                letterSpacing: "0.06em",
                textTransform: "uppercase",
                color: "var(--text-muted)",
              }}
            >
              {t("riskLevel.label")}
            </span>
            {/* Risk level conveys meaning via icon + color + text (WCAG AA) — never
                color alone. */}
            <Badge
              color={RISK_META[brief.risk_level]?.color ?? "var(--text-secondary)"}
              bg={RISK_META[brief.risk_level]?.bg}
              icon="AlertTriangle"
            >
              {t(`riskLevel.${brief.risk_level as RiskSeverity}`)}
            </Badge>
          </div>

          {brief.risks.length > 0 && (
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              {brief.risks.map((risk, i) => (
                <div key={i} style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                    <Icon.AlertTriangle size={13} style={{ color: RISK_META[risk.severity]?.color, flexShrink: 0 }} />
                    <span style={{ fontSize: 13, fontWeight: 600, color: "var(--text-primary)" }}>{risk.title}</span>
                  </div>
                  <p style={{ fontSize: 12.5, color: "var(--text-secondary)", margin: "0 0 0 19px", lineHeight: 1.5 }}>
                    {risk.explanation}
                  </p>
                  {risk.file_refs.length > 0 && (
                    <div style={{ display: "flex", flexWrap: "wrap", gap: 8, margin: "0 0 0 19px" }}>
                      {risk.file_refs.map((ref, j) => (
                        <FileRefLink key={j} pathname={pathname} refStr={ref} />
                      ))}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </Card>
  );
}
