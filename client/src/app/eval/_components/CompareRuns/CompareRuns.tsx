/* CompareRuns — modal comparing two eval runs: metric deltas (recall /
   precision / citation_accuracy) as number + delta, and a diff of their
   persisted system-prompt snapshots. A run predating snapshots simply omits
   the prompt-diff (fail-soft, AC-22) but always shows the deltas. "Promote"
   re-runs the set against the agent's current prompt via the same batch-run
   mutation used by the Evals tab / Dashboard — it produces a new run, it does
   NOT activate any prompt version (AC-23, non-goal). */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Modal, Button } from "@devdigest/ui";
import type { EvalRunRecord } from "@devdigest/shared";
import { useRunEvalSet } from "../../../../lib/hooks/eval";
import { diffLines, extractPromptSnapshot, formatDelta, formatMetric, formatRunLabel } from "./helpers";
import { s } from "./styles";

const METRICS = [
  { key: "recall", labelKey: "recall" },
  { key: "precision", labelKey: "precision" },
  { key: "citation_accuracy", labelKey: "citationAccuracy" },
] as const;

const FOCUSABLE_SELECTOR =
  'button:not([disabled]), [href], input, select, textarea, [tabindex]:not([tabindex="-1"])';

export function CompareRuns({
  agentId,
  runs,
  onClose,
}: {
  agentId: string;
  runs: [EvalRunRecord, EvalRunRecord];
  onClose: () => void;
}) {
  const t = useTranslations("eval");
  const promote = useRunEvalSet();
  const [runA, runB] = runs;
  const containerRef = React.useRef<HTMLDivElement>(null);

  // Escape closes the modal; Tab is trapped within the dialog's focusables.
  React.useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        onClose();
        return;
      }
      if (e.key !== "Tab") return;
      const node = containerRef.current;
      if (!node) return;
      const focusables = Array.from(node.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR));
      if (focusables.length === 0) return;
      const first = focusables[0]!;
      const last = focusables[focusables.length - 1]!;
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  React.useEffect(() => {
    containerRef.current?.querySelector<HTMLElement>(FOCUSABLE_SELECTOR)?.focus();
  }, []);

  const snapshotA = extractPromptSnapshot(runA);
  const snapshotB = extractPromptSnapshot(runB);
  const diff =
    snapshotA && snapshotB ? diffLines(snapshotA.system_prompt, snapshotB.system_prompt) : null;

  return (
    <div ref={containerRef}>
      <Modal
        width={860}
        title={t("dashboard.compareRuns.title")}
        subtitle={t("dashboard.compareRuns.subtitle", {
          a: formatRunLabel(runA),
          b: formatRunLabel(runB),
        })}
        onClose={onClose}
        footer={
          <div style={s.footer}>
            <div style={s.promoteNote}>{t("dashboard.compareRuns.promoteNote")}</div>
            <Button kind="ghost" onClick={onClose}>
              {t("dashboard.compareRuns.close")}
            </Button>
            <Button
              kind="primary"
              icon="RefreshCw"
              onClick={() => promote.mutate(agentId)}
              disabled={promote.isPending}
            >
              {promote.isPending ? t("dashboard.compareRuns.promoting") : t("dashboard.compareRuns.promote")}
            </Button>
          </div>
        }
      >
        <div style={s.body}>
          <div style={s.metricsGrid}>
            {METRICS.map(({ key, labelKey }) => (
              <div key={key} style={s.metricCard}>
                <div style={s.metricLabel}>{t(`dashboard.compareRuns.metrics.${labelKey}`)}</div>
                <div style={s.metricRow}>
                  <span>{formatMetric(runA[key])}</span>
                  <span style={s.arrow}>→</span>
                  <span>{formatMetric(runB[key])}</span>
                </div>
                <div style={s.metricDelta}>{formatDelta(runA[key], runB[key])}</div>
              </div>
            ))}
          </div>

          {diff ? (
            <div>
              <div style={s.sectionTitle}>{t("dashboard.compareRuns.promptDiffTitle")}</div>
              <pre style={s.diffBlock}>
                {diff.map((line, i) => (
                  <div
                    key={i}
                    style={
                      line.type === "added" ? s.diffAdded : line.type === "removed" ? s.diffRemoved : s.diffSame
                    }
                  >
                    {line.type === "added" ? "+ " : line.type === "removed" ? "- " : "  "}
                    {line.text}
                  </div>
                ))}
              </pre>
            </div>
          ) : (
            <div role="status" style={s.noSnapshot}>
              {t("dashboard.compareRuns.noSnapshot")}
            </div>
          )}

          {promote.isSuccess && (
            <div role="status" style={s.statusNote}>
              {t("dashboard.compareRuns.promoted")}
            </div>
          )}
          {promote.isError && (
            <div role="alert" style={s.errorNote}>
              {t("dashboard.compareRuns.promoteError")}
            </div>
          )}
        </div>
      </Modal>
    </div>
  );
}
