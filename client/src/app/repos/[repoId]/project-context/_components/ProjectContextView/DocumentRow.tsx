"use client";

import { useTranslations } from "next-intl";
import { Badge, Card, IconBtn } from "@devdigest/ui";
import type { DiscoveredDocument } from "@devdigest/shared";
import { BUCKET_META, splitPath } from "./helpers";

/** One row per discovered document: filename, folder path, bucket badge
    (colour + text label — never colour alone), and a Preview affordance. */
export function DocumentRow({
  doc,
  onPreview,
}: {
  doc: DiscoveredDocument;
  onPreview: () => void;
}) {
  const t = useTranslations("projectContext");
  const { filename, folder } = splitPath(doc.path);
  const meta = BUCKET_META[doc.bucket];

  return (
    <Card
      style={{
        display: "flex",
        alignItems: "center",
        gap: 12,
        padding: "12px 16px",
      }}
    >
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 14, fontWeight: 600, color: "var(--text-primary)" }}>
          {filename}
        </div>
        {folder && (
          <div
            style={{
              fontSize: 12,
              color: "var(--text-muted)",
              marginTop: 2,
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}
          >
            {folder}
          </div>
        )}
      </div>

      <Badge color={meta.color} bg={meta.bg} icon={meta.icon}>
        {t(`bucket.${doc.bucket}`)}
      </Badge>

      <span style={{ fontSize: 12, color: "var(--text-muted)" }}>
        {t("row.tokens", { count: doc.estimated_tokens })}
      </span>

      <IconBtn icon="Eye" label={t("row.preview")} onClick={onPreview} />
    </Card>
  );
}
