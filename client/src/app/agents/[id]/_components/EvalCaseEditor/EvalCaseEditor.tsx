/* EvalCaseEditor — modal to create or edit an agent eval case: Name, Input
   (Diff / Files / PR meta tabs), Expected output (ExpectedFinding[] JSON editor
   with a live validity indicator), and a footer to Save and/or Run the case.

   Save calls the update mutation (PATCH /eval-cases/:id) when `evalCase` was
   passed in with an id — the existing case is updated in place. When opened
   for "New eval case" (no `evalCase`), Save calls the create mutation instead.
   `Run case` targets whichever case id is currently on-hand (the original
   `evalCase.id`, or the id just returned by Save). */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { z } from "zod";
import {
  Button,
  FormField,
  Modal,
  Tabs,
  TextInput,
  Textarea,
  Toggle,
} from "@devdigest/ui";
import { ExpectedFinding, type EvalCase, type EvalRunResult } from "@devdigest/shared";
import { useCreateEvalCase, useRunEvalCase, useUpdateEvalCase } from "@/lib/hooks/eval";

type InputTab = "diff" | "files" | "meta";

interface PrMeta {
  title: string;
  body: string;
}

const EMPTY_FINDING_SKELETON = {
  severity: "WARNING" as const,
  category: "bug" as const,
  title: "",
  file: "",
  start_line: 1,
  end_line: null,
};

/** Parses the Expected-output textarea contents as `ExpectedFinding[]`.
 *  Pure — recomputed on every render from the current text, never cached in
 *  state (derive, don't store). */
function parseExpectedOutput(text: string): {
  valid: boolean;
  value: ExpectedFinding[];
} {
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    return { valid: false, value: [] };
  }
  const result = z.array(ExpectedFinding).safeParse(json);
  if (!result.success) return { valid: false, value: [] };
  return { valid: true, value: result.data };
}

/** Parses the optional Files textarea as arbitrary JSON (`input_files`). A
 *  blank textarea is treated as "no files" rather than invalid. */
function parseFilesInput(text: string): { valid: boolean; value: unknown } {
  const trimmed = text.trim();
  if (!trimmed) return { valid: true, value: null };
  try {
    return { valid: true, value: JSON.parse(trimmed) };
  } catch {
    return { valid: false, value: null };
  }
}

function producedCount(actual: unknown): number {
  return Array.isArray(actual) ? actual.length : 0;
}

function formatCost(cost: number | null): string {
  return cost == null ? "—" : `$${cost.toFixed(4)}`;
}

function formatDuration(ms: number): string {
  return `${(ms / 1000).toFixed(1)}s`;
}

export interface EvalCaseEditorProps {
  agentId: string;
  agentName: string;
  /** When provided (with an id), seeds the form from this case and Save
   *  updates it in place via `useUpdateEvalCase`. */
  evalCase?: EvalCase | null;
  onClose: () => void;
  onSaved?: (savedCase: EvalCase) => void;
}

export function EvalCaseEditor({
  agentId,
  agentName,
  evalCase,
  onClose,
  onSaved,
}: EvalCaseEditorProps) {
  const t = useTranslations("eval.caseEditor");

  const [name, setName] = React.useState(evalCase?.name ?? "");
  const [inputTab, setInputTab] = React.useState<InputTab>("diff");
  const [inputDiff, setInputDiff] = React.useState(evalCase?.input_diff ?? "");
  const [filesText, setFilesText] = React.useState(
    evalCase?.input_files != null ? JSON.stringify(evalCase.input_files, null, 2) : "",
  );
  const [meta, setMeta] = React.useState<PrMeta>(() => {
    const m = evalCase?.input_meta;
    if (m && typeof m === "object") {
      const obj = m as Record<string, unknown>;
      return {
        title: typeof obj.title === "string" ? obj.title : "",
        body: typeof obj.body === "string" ? obj.body : "",
      };
    }
    return { title: "", body: "" };
  });
  const [expectedText, setExpectedText] = React.useState(
    evalCase?.expected_output != null
      ? JSON.stringify(evalCase.expected_output, null, 2)
      : "[]",
  );
  const [runOnSave, setRunOnSave] = React.useState(false);
  const [savedCaseId, setSavedCaseId] = React.useState<string | null>(
    evalCase?.id ?? null,
  );

  const dialogRef = React.useRef<HTMLDivElement>(null);

  React.useEffect(() => {
    // Focus the first focusable element (the Name input) once the modal paints.
    const timer = setTimeout(() => {
      dialogRef.current?.querySelector<HTMLElement>("input, textarea")?.focus();
    }, 0);
    return () => clearTimeout(timer);
  }, []);

  // Escape-to-close + a lightweight Tab focus trap — the shared Modal shell
  // doesn't wire either, so this component owns keyboard operability.
  React.useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") {
        onClose();
        return;
      }
      if (e.key !== "Tab" || !dialogRef.current) return;
      const focusable = dialogRef.current.querySelectorAll<HTMLElement>(
        'button, input, textarea, [href], [tabindex]:not([tabindex="-1"])',
      );
      if (focusable.length === 0) return;
      const first = focusable[0]!;
      const last = focusable[focusable.length - 1]!;
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    }
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [onClose]);

  const isEditing = evalCase?.id != null;
  const createCase = useCreateEvalCase();
  const updateCase = useUpdateEvalCase();
  const saveMutation = isEditing ? updateCase : createCase;
  const runEvalCase = useRunEvalCase();

  const { valid: isExpectedValid, value: parsedExpected } =
    parseExpectedOutput(expectedText);
  const { valid: isFilesValid, value: parsedFiles } = parseFilesInput(filesText);

  const canSave =
    name.trim().length > 0 && isExpectedValid && isFilesValid && !saveMutation.isPending;
  const canRun = savedCaseId != null && isExpectedValid && !runEvalCase.isPending;

  const handleAddSkeleton = () => {
    const { valid, value } = parseExpectedOutput(expectedText);
    const next = valid ? [...value, EMPTY_FINDING_SKELETON] : [EMPTY_FINDING_SKELETON];
    setExpectedText(JSON.stringify(next, null, 2));
  };

  const handleRun = (caseId: string) => {
    runEvalCase.mutate(caseId);
  };

  const handleSave = () => {
    if (!canSave) return;
    const input = {
      owner_kind: "agent" as const,
      owner_id: agentId,
      name: name.trim(),
      input_diff: inputDiff,
      input_files: parsedFiles,
      input_meta: meta.title || meta.body ? meta : null,
      expected_output: parsedExpected,
      notes: null,
    };
    const onSuccess = (saved: EvalCase) => {
      setSavedCaseId(saved.id);
      onSaved?.(saved);
      if (runOnSave) handleRun(saved.id);
    };
    if (isEditing && evalCase) {
      updateCase.mutate({ id: evalCase.id, input }, { onSuccess });
    } else {
      createCase.mutate(input, { onSuccess });
    }
  };

  const runResult: EvalRunResult | undefined = runEvalCase.data;

  return (
    <div ref={dialogRef}>
      <Modal
        width={720}
        title={t("caseTitle", { name: name.trim() || t("newCase") })}
        subtitle={t("subtitle", { agent: agentName })}
        onClose={onClose}
        footer={
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            {runResult && (
              <div
                role="status"
                style={{ fontSize: 13, color: "var(--text-secondary)" }}
              >
                {t(runResult.result.per_trace[0]?.pass ? "lastRunPassed" : "lastRunFailed")}
                {" · "}
                {t("statusDetails", {
                  expected: parsedExpected.length,
                  got: producedCount(runResult.result.per_trace[0]?.actual),
                  duration: formatDuration(runResult.result.duration_ms),
                  cost: formatCost(runResult.result.cost_usd),
                })}
              </div>
            )}
            {runEvalCase.isError && (
              <div role="alert" style={{ fontSize: 12, color: "var(--crit)" }}>
                {String(runEvalCase.error)}
              </div>
            )}
            {saveMutation.isError && (
              <div role="alert" style={{ fontSize: 12, color: "var(--crit)" }}>
                {String(saveMutation.error)}
              </div>
            )}
            <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
              <label
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 8,
                  fontSize: 13,
                  color: "var(--text-secondary)",
                }}
              >
                <Toggle on={runOnSave} onChange={setRunOnSave} />
                {t("runOnSave")}
              </label>
              <div style={{ flex: 1 }} />
              <Button kind="ghost" onClick={onClose}>
                {t("cancel")}
              </Button>
              <Button
                kind="secondary"
                onClick={() => savedCaseId && handleRun(savedCaseId)}
                disabled={!canRun}
                loading={runEvalCase.isPending}
              >
                {runEvalCase.isPending ? t("running") : t("runCase")}
              </Button>
              <Button
                kind="primary"
                onClick={handleSave}
                disabled={!canSave}
                loading={saveMutation.isPending}
              >
                {saveMutation.isPending ? t("saving") : t("save")}
              </Button>
            </div>
          </div>
        }
      >
        <div style={{ padding: "20px 24px", display: "flex", flexDirection: "column", gap: 4 }}>
          <FormField label={t("nameLabel")} required>
            <TextInput
              value={name}
              onChange={setName}
              placeholder={t("namePlaceholder")}
            />
          </FormField>

          <FormField label={t("inputLabel")}>
            <Tabs
              pad="0"
              tabs={[
                { key: "diff", label: t("tabs.diff") },
                { key: "files", label: t("tabs.files") },
                { key: "meta", label: t("tabs.prMeta") },
              ]}
              value={inputTab}
              onChange={(k) => setInputTab(k as InputTab)}
            />
            <div style={{ marginTop: 12 }}>
              {inputTab === "diff" && (
                <Textarea
                  mono
                  rows={8}
                  value={inputDiff}
                  onChange={setInputDiff}
                  placeholder={t("diffPlaceholder")}
                />
              )}
              {inputTab === "files" && (
                <>
                  <Textarea
                    mono
                    rows={8}
                    value={filesText}
                    onChange={setFilesText}
                    placeholder={t("filesPlaceholder")}
                  />
                  {!isFilesValid && (
                    <div style={{ fontSize: 12, color: "var(--crit)", marginTop: 6 }}>
                      {t("invalidJson")}
                    </div>
                  )}
                </>
              )}
              {inputTab === "meta" && (
                <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                  <FormField label={t("titleLabel")}>
                    <TextInput
                      value={meta.title}
                      onChange={(v) => setMeta((m) => ({ ...m, title: v }))}
                      placeholder={t("titlePlaceholder")}
                    />
                  </FormField>
                  <FormField label={t("bodyLabel")}>
                    <Textarea
                      rows={4}
                      value={meta.body}
                      onChange={(v) => setMeta((m) => ({ ...m, body: v }))}
                      placeholder={t("bodyPlaceholder")}
                    />
                  </FormField>
                  {(meta.title || meta.body) && (
                    <div>
                      <div style={{ fontSize: 12, fontWeight: 600, color: "var(--text-muted)", marginBottom: 4 }}>
                        {t("preview")}
                      </div>
                      <div style={{ fontSize: 13, color: "var(--text-secondary)", whiteSpace: "pre-wrap" }}>
                        {meta.title}
                        {meta.title && meta.body ? "\n\n" : ""}
                        {meta.body}
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
          </FormField>

          <FormField
            label={t("expectedOutput")}
            right={
              <span
                role="status"
                style={{
                  fontSize: 12,
                  fontWeight: 600,
                  color: isExpectedValid ? "var(--ok, #16a34a)" : "var(--crit)",
                }}
              >
                {isExpectedValid ? t("validJson") : t("invalidJson")}
              </span>
            }
          >
            <Textarea mono rows={8} value={expectedText} onChange={setExpectedText} />
            <div style={{ marginTop: 8 }}>
              <Button kind="secondary" size="sm" icon="Plus" onClick={handleAddSkeleton}>
                {t("addSkeleton")}
              </Button>
            </div>
          </FormField>
        </div>
      </Modal>
    </div>
  );
}
