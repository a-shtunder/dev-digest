import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { EvalCase, EvalRunResult } from "@devdigest/shared";
import messages from "../../../../../../messages/en/eval.json";

const runMutate = vi.fn();
const createMutate = vi.fn();
const updateMutate = vi.fn();
let runData: EvalRunResult | undefined;

vi.mock("../../../../../lib/hooks/eval", () => ({
  useCreateEvalCase: () => ({
    mutate: createMutate,
    isPending: false,
    isError: false,
    error: null,
  }),
  useUpdateEvalCase: () => ({
    mutate: updateMutate,
    isPending: false,
    isError: false,
    error: null,
  }),
  useRunEvalCase: () => ({
    mutate: runMutate,
    isPending: false,
    isError: false,
    error: null,
    data: runData,
  }),
}));

import { EvalCaseEditor } from "./EvalCaseEditor";

afterEach(() => {
  cleanup();
  runMutate.mockClear();
  createMutate.mockClear();
  updateMutate.mockClear();
  runData = undefined;
});

const EXISTING_CASE: EvalCase = {
  id: "case1",
  owner_kind: "agent",
  owner_id: "ag1",
  name: "stripe-key-leak",
  input_diff: "--- a/src/config.ts\n+++ b/src/config.ts",
  input_files: null,
  input_meta: null,
  expected_output: [
    {
      severity: "CRITICAL",
      category: "security",
      title: "Hardcoded Stripe key",
      file: "src/config.ts",
      start_line: 12,
      end_line: 12,
    },
  ],
  notes: null,
};

function renderWithIntl(ui: React.ReactElement) {
  return render(
    <NextIntlClientProvider locale="en" messages={{ eval: messages }}>
      {ui}
    </NextIntlClientProvider>,
  );
}

describe("EvalCaseEditor", () => {
  it("shows invalid indicator and guards Save/Run when JSON is malformed", () => {
    renderWithIntl(
      <EvalCaseEditor
        agentId="ag1"
        agentName="Security Reviewer"
        evalCase={EXISTING_CASE}
        onClose={() => {}}
      />,
    );

    // Starts valid (seeded from EXISTING_CASE.expected_output)
    expect(screen.getByText("valid JSON")).toBeInTheDocument();

    const textarea = screen.getAllByRole("textbox").find(
      (el) => (el as HTMLTextAreaElement).value.includes("Hardcoded Stripe key"),
    ) as HTMLTextAreaElement;
    expect(textarea).toBeTruthy();

    fireEvent.change(textarea, { target: { value: "{not valid json" } });

    expect(screen.getByText("invalid JSON")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^Save$/ })).toBeDisabled();
    expect(screen.getByRole("button", { name: /Run case/ })).toBeDisabled();
  });

  it("inserts a finding skeleton template into the expected-output editor", () => {
    renderWithIntl(
      <EvalCaseEditor
        agentId="ag1"
        agentName="Security Reviewer"
        evalCase={null}
        onClose={() => {}}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: /Finding skeleton/i }));

    const textarea = screen.getAllByRole("textbox").find(
      (el) => (el as HTMLTextAreaElement).value.includes('"severity"'),
    ) as HTMLTextAreaElement;
    expect(textarea.value).toContain('"WARNING"');
    expect(textarea.value).toContain('"start_line": 1');
  });

  it("Save updates the existing case in place instead of creating a new one", () => {
    renderWithIntl(
      <EvalCaseEditor
        agentId="ag1"
        agentName="Security Reviewer"
        evalCase={EXISTING_CASE}
        onClose={() => {}}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: /^Save$/ }));

    expect(updateMutate).toHaveBeenCalledTimes(1);
    expect(updateMutate).toHaveBeenCalledWith(
      expect.objectContaining({
        id: "case1",
        input: expect.objectContaining({ name: "stripe-key-leak" }),
      }),
      expect.anything(),
    );
    expect(createMutate).not.toHaveBeenCalled();
  });

  it("Save creates a new case when opened for a brand-new eval case", () => {
    renderWithIntl(
      <EvalCaseEditor
        agentId="ag1"
        agentName="Security Reviewer"
        evalCase={null}
        onClose={() => {}}
      />,
    );

    const nameInput = screen.getAllByRole("textbox")[0] as HTMLInputElement;
    fireEvent.change(nameInput, { target: { value: "New case" } });
    fireEvent.click(screen.getByRole("button", { name: /^Save$/ }));

    expect(createMutate).toHaveBeenCalledTimes(1);
    expect(updateMutate).not.toHaveBeenCalled();
  });

  it("runs the case and renders the status line from the run result", () => {
    runData = {
      run_id: "run1",
      case_id: "case1",
      result: {
        recall: 1,
        precision: 1,
        citation_accuracy: 1,
        traces_passed: 1,
        traces_total: 1,
        duration_ms: 2500,
        cost_usd: 0.012,
        per_trace: [{ name: "stripe-key-leak", pass: true, expected: [], actual: [{ id: "f1" }] }],
      },
    };

    renderWithIntl(
      <EvalCaseEditor
        agentId="ag1"
        agentName="Security Reviewer"
        evalCase={EXISTING_CASE}
        onClose={() => {}}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: /Run case/ }));
    expect(runMutate).toHaveBeenCalledWith("case1");

    expect(screen.getByText(/Last run passed/)).toBeInTheDocument();
    expect(screen.getByText(/expected 1 finding, got 1/)).toBeInTheDocument();
  });
});
