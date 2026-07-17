/**
 * CompareRuns — two runs with matching prompt snapshots show metric deltas
 * + a prompt diff (AC-22); a run without a snapshot still shows deltas but
 * omits the diff, fail-soft (AC-22); Promote fires the same batch-run
 * mutation used elsewhere in the eval flow (AC-23), without touching any
 * "active version" concept.
 */
import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { EvalRunRecord } from "@devdigest/shared";
import evalMessages from "../../../../../messages/en/eval.json";

const runEvalSetMutate = vi.fn();
let runEvalSetState: { isPending: boolean; isSuccess: boolean; isError: boolean } = {
  isPending: false,
  isSuccess: false,
  isError: false,
};
vi.mock("@/lib/hooks/eval", () => ({
  useRunEvalSet: () => ({ mutate: runEvalSetMutate, ...runEvalSetState }),
}));

import { CompareRuns } from "./CompareRuns";

afterEach(() => {
  cleanup();
  runEvalSetMutate.mockClear();
  runEvalSetState = { isPending: false, isSuccess: false, isError: false };
});

function renderWithIntl(ui: React.ReactElement) {
  return render(
    <NextIntlClientProvider locale="en" messages={{ eval: evalMessages }}>
      {ui}
    </NextIntlClientProvider>,
  );
}

function run(o: Partial<EvalRunRecord> = {}): EvalRunRecord {
  return {
    id: "run-1",
    case_id: "case-1",
    case_name: "stripe-key-leak",
    ran_at: "2026-07-10T00:00:00.000Z",
    actual_output: null,
    pass: true,
    recall: 0.8,
    precision: 0.9,
    citation_accuracy: 0.7,
    duration_ms: 1200,
    cost_usd: 0.01,
    ...o,
  };
}

describe("CompareRuns", () => {
  it("shows metric deltas and a prompt diff when both runs carry a snapshot", () => {
    const runA = run({
      id: "run-1",
      recall: 0.8,
      precision: 0.9,
      citation_accuracy: 0.7,
      actual_output: { prompt_snapshot: { system_prompt: "line one\nline two", model: "gpt-4.1" } },
    });
    const runB = run({
      id: "run-2",
      case_name: "stripe-key-leak-v2",
      recall: 0.85,
      precision: 0.88,
      citation_accuracy: 0.72,
      actual_output: { prompt_snapshot: { system_prompt: "line one\nline three", model: "gpt-4.1" } },
    });

    renderWithIntl(<CompareRuns agentId="agent-1" runs={[runA, runB]} onClose={vi.fn()} />);

    // Metric numbers + deltas rendered.
    expect(screen.getByText("80.0%")).toBeInTheDocument();
    expect(screen.getByText("85.0%")).toBeInTheDocument();
    expect(screen.getByText("+5.0%")).toBeInTheDocument(); // recall delta
    expect(screen.getByText("-2.0%")).toBeInTheDocument(); // precision delta

    // Prompt diff visible: unchanged, removed, and added lines.
    expect(screen.getByText("System prompt diff")).toBeInTheDocument();
    expect(screen.getByText(/line one/)).toBeInTheDocument();
    expect(screen.getByText(/line two/)).toBeInTheDocument();
    expect(screen.getByText(/line three/)).toBeInTheDocument();
    expect(
      screen.queryByText("Prompt snapshot not available for one of these runs — diff omitted."),
    ).not.toBeInTheDocument();
  });

  it("omits the prompt diff (no error) when a run lacks a snapshot, keeping the deltas", () => {
    const runA = run({ id: "run-1", recall: 0.8, actual_output: null });
    const runB = run({
      id: "run-2",
      recall: 0.85,
      actual_output: { prompt_snapshot: { system_prompt: "line one", model: "gpt-4.1" } },
    });

    renderWithIntl(<CompareRuns agentId="agent-1" runs={[runA, runB]} onClose={vi.fn()} />);

    expect(
      screen.getByText("Prompt snapshot not available for one of these runs — diff omitted."),
    ).toBeInTheDocument();
    expect(screen.queryByText("System prompt diff")).not.toBeInTheDocument();
    // Deltas still shown.
    expect(screen.getByText("80.0%")).toBeInTheDocument();
    expect(screen.getByText("85.0%")).toBeInTheDocument();
  });

  it("Promote fires the batch-run mutation for the agent, and Escape closes the modal", () => {
    const onClose = vi.fn();
    const runA = run({ id: "run-1" });
    const runB = run({ id: "run-2" });
    renderWithIntl(<CompareRuns agentId="agent-42" runs={[runA, runB]} onClose={onClose} />);

    fireEvent.click(screen.getByRole("button", { name: "Promote" }));
    expect(runEvalSetMutate).toHaveBeenCalledTimes(1);
    expect(runEvalSetMutate).toHaveBeenCalledWith("agent-42");

    fireEvent.keyDown(document, { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
