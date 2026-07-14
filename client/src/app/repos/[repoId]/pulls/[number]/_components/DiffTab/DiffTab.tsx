"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { SectionLabel, Button, Chip } from "@devdigest/ui";
import { DiffViewer, type DiffCommentApi } from "@/components/diff-viewer";
import { SmartDiffViewer } from "@/components/smart-diff-viewer";
import { usePrComments, useCreatePrComment, usePrReviews, useSmartDiff } from "@/lib/hooks";
import { notify } from "@/lib/contexts/toast";
import type { PrFile } from "@devdigest/shared";

interface DiffTabProps {
  prId: string | null;
  filesCount: number;
  files: PrFile[];
  /** Inline commenting is offered only on open PRs (GitHub rejects otherwise). */
  canComment?: boolean;
}

export function DiffTab({ prId, filesCount, files, canComment }: DiffTabProps) {
  const t = useTranslations("shell");
  const { data: comments } = usePrComments(prId);
  const create = useCreatePrComment(prId);
  // Comments start hidden so the diff is clean by default — toggle to reveal.
  const [showComments, setShowComments] = React.useState(false);
  // Smart order is the default view — a deterministic client-side recomposition
  // of the same files + the last review's findings (no new LLM calls).
  const [order, setOrder] = React.useState<"smart" | "original">("smart");

  const { data: smartDiff, isLoading: smartDiffLoading } = useSmartDiff(prId);
  const { data: reviews } = usePrReviews(prId);
  const latestReview = reviews?.find((r) => r.kind === "review");
  const latestReviewFindings = latestReview?.findings ?? [];

  const commentCount = comments?.length ?? 0;

  const commenting: DiffCommentApi = {
    comments: comments ?? [],
    canComment: !!canComment && !!prId,
    showComments,
    posting: create.isPending,
    onSubmit: async (input) => {
      try {
        const res = await create.mutateAsync(input);
        setShowComments(true); // a just-posted comment shouldn't stay hidden
        return res;
      } catch (err) {
        notify.error(err instanceof Error ? err.message : "Couldn't post the comment to GitHub.");
        throw err;
      }
    },
  };

  return (
    <section>
      <SectionLabel
        icon="Code"
        right={
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <div style={{ display: "flex", gap: 4 }}>
              <Chip active={order === "smart"} onClick={() => setOrder("smart")}>
                {t("smartDiff.smartOrder")}
              </Chip>
              <Chip active={order === "original"} onClick={() => setOrder("original")}>
                {t("smartDiff.originalOrder")}
              </Chip>
            </div>
            {commentCount > 0 && (
              <Button
                kind="ghost"
                size="sm"
                icon={showComments ? "EyeOff" : "Eye"}
                onClick={() => setShowComments((v) => !v)}
              >
                {showComments ? "Hide comments" : "Show comments"} ({commentCount})
              </Button>
            )}
          </div>
        }
      >
        Files changed · {filesCount} files
      </SectionLabel>
      {order === "original" ? (
        <DiffViewer files={files} commenting={commenting} />
      ) : smartDiffLoading ? (
        <div style={{ padding: 24, fontSize: 14, color: "var(--text-muted)", textAlign: "center" }}>
          {t("smartDiff.loading")}
        </div>
      ) : smartDiff ? (
        <SmartDiffViewer files={files} smartDiff={smartDiff} findings={latestReviewFindings} prId={prId} />
      ) : (
        <div style={{ padding: 24, fontSize: 14, color: "var(--text-muted)", textAlign: "center" }}>
          {t("smartDiff.empty")}
        </div>
      )}
    </section>
  );
}
