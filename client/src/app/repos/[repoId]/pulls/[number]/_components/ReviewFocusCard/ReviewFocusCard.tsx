/* ReviewFocusCard — full-width "Review Focus — Read These First" card,
   sibling to PrBriefCard. Extracted into its own titled block (rather than
   nested inside PrBriefCard) so it reads as its own section, matching the
   PR-brief design: verdict banner (full width) → Intent/Blast Radius row →
   Review Focus (full width). Renders nothing when there's no brief yet or
   the generated brief has no review-focus items (AC-21) — the empty/loading/
   error/Generate-CTA states live on PrBriefCard, not duplicated here. */
"use client";

import React from "react";
import { usePathname } from "next/navigation";
import { useTranslations } from "next-intl";
import { Card, SectionLabel, Badge } from "@devdigest/ui";
import { useBrief } from "@/lib/hooks/brief";
import { FileRefLink } from "../PrBriefCard/fileRef";

export function ReviewFocusCard({ prId }: { prId: string | number | null }) {
  const t = useTranslations("brief-card");
  const pathname = usePathname();
  const { data } = useBrief(prId);

  const items = data?.brief?.review_focus ?? [];
  if (items.length === 0) return null;

  return (
    <Card pad style={{ marginBottom: 0 }}>
      <SectionLabel
        icon="Target"
        right={<Badge color="var(--text-secondary)">{items.length}</Badge>}
      >
        {t("reviewFocus.title")}
      </SectionLabel>
      <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "flex", flexDirection: "column", gap: 10 }}>
        {items.map((item, i) => (
          <li key={i} style={{ display: "flex", flexDirection: "column", gap: 2 }}>
            <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
              <span style={{ fontSize: 13, fontWeight: 600, color: "var(--text-primary)" }}>{item.label}</span>
              <FileRefLink pathname={pathname} refStr={item.file_ref} />
            </div>
            <span style={{ fontSize: 12.5, color: "var(--text-muted)" }}>{item.reason}</span>
          </li>
        ))}
      </ul>
    </Card>
  );
}
