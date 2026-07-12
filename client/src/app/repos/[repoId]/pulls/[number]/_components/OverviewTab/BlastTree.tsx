/* BlastTree.tsx — disclosure list: one expandable row per changed symbol,
   expanding to show each caller as a file:line link (same pattern as
   FindingCard.tsx's MonoLink + githubBlobUrl usage). */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Icon, MonoLink, Badge } from "@devdigest/ui";
import type { BlastSymbolGroup } from "./blastViewModel";
import { githubBlobUrl } from "@/lib/utils/githubUrls";

export function BlastTree({
  groups,
  repoFullName,
  headSha,
}: {
  groups: BlastSymbolGroup[];
  repoFullName: string | null;
  headSha: string | null;
}) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
      {groups.map((group) => (
        <BlastSymbolRow
          key={`${group.symbol.file}:${group.symbol.name}`}
          group={group}
          repoFullName={repoFullName}
          headSha={headSha}
        />
      ))}
    </div>
  );
}

function BlastSymbolRow({
  group,
  repoFullName,
  headSha,
}: {
  group: BlastSymbolGroup;
  repoFullName: string | null;
  headSha: string | null;
}) {
  const t = useTranslations("blast");
  const [expanded, setExpanded] = React.useState(false);

  return (
    <div style={{ border: "1px solid var(--border)", borderRadius: 6 }}>
      <div
        onClick={() => setExpanded((e) => !e)}
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          padding: "8px 10px",
          cursor: "pointer",
        }}
      >
        <Icon.ChevronRight
          size={14}
          style={{
            color: "var(--text-muted)",
            flexShrink: 0,
            transform: expanded ? "rotate(90deg)" : undefined,
            transition: "transform .12s",
          }}
        />
        <span className="mono" style={{ fontSize: 13, fontWeight: 600, color: "var(--text-primary)" }}>
          {group.symbol.name}
        </span>
        <span style={{ fontSize: 11, color: "var(--text-muted)" }}>{group.symbol.kind}</span>
        <span style={{ marginLeft: "auto", fontSize: 12, color: "var(--text-muted)" }}>
          {t("callerCount", { count: group.callers.length })}
        </span>
      </div>

      {expanded && (
        <div style={{ padding: "0 10px 10px 32px", display: "flex", flexDirection: "column", gap: 6 }}>
          {group.callers.map((caller, i) => {
            const href =
              repoFullName && headSha
                ? githubBlobUrl(repoFullName, headSha, caller.file, caller.line)
                : undefined;
            return (
              <MonoLink key={i} href={href}>
                {caller.file}:{caller.line}
              </MonoLink>
            );
          })}

          {(group.endpoints.length > 0 || group.crons.length > 0) && (
            <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: 4 }}>
              {group.endpoints.map((endpoint) => (
                <Badge key={endpoint} icon="Globe" mono>
                  {endpoint}
                </Badge>
              ))}
              {group.crons.map((cron) => (
                <Badge key={cron} icon="Clock" mono>
                  {cron}
                </Badge>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
