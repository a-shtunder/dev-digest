import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { EvalCase, EvalDashboard } from "@devdigest/shared";
import messages from "../../../../../../messages/en/eval.json";

const runSetMutate = vi.fn();
const runCaseMutate = vi.fn();
const deleteCaseMutate = vi.fn();

let casesData: EvalCase[] | undefined;
let casesLoading = false;
let casesError = false;
let dashboardData: EvalDashboard | undefined;

vi.mock("../../../../../lib/hooks/eval", () => ({
  useEvalCases: () => ({
    data: casesData,
    isLoading: casesLoading,
    isError: casesError,
    refetch: vi.fn(),
  }),
  useEvalAgentDashboard: () => ({ data: dashboardData }),
  useRunEvalSet: () => ({
    mutate: runSetMutate,
    isPending: false,
  }),
  useRunEvalCase: () => ({
    mutate: runCaseMutate,
    isPending: false,
    variables: undefined,
  }),
  // Also mocked because EvalCaseEditor (rendered by EvalsTab when opened)
  // imports these hooks directly.
  useCreateEvalCase: () => ({
    mutate: vi.fn(),
    isPending: false,
    isError: false,
    error: null,
  }),
  useUpdateEvalCase: () => ({
    mutate: vi.fn(),
    isPending: false,
    isError: false,
    error: null,
  }),
  useDeleteEvalCase: () => ({
    mutate: deleteCaseMutate,
    isPending: false,
    variables: undefined,
  }),
}));

import { EvalsTab } from "./EvalsTab";

afterEach(() => {
  cleanup();
  runSetMutate.mockClear();
  runCaseMutate.mockClear();
  deleteCaseMutate.mockClear();
  casesData = undefined;
  casesLoading = false;
  casesError = false;
  dashboardData = undefined;
});

const CASE_1: EvalCase = {
  id: "case1",
  owner_kind: "agent",
  owner_id: "ag1",
  name: "stripe-key-leak",
  input_diff: "--- a/src/config.ts",
  input_files: null,
  input_meta: null,
  expected_output: [],
  notes: null,
};

const CASE_2: EvalCase = {
  id: "case2",
  owner_kind: "agent",
  owner_id: "ag1",
  name: "sql-injection",
  input_diff: "--- a/src/db.ts",
  input_files: null,
  input_meta: null,
  expected_output: [],
  notes: null,
};

const DASHBOARD: EvalDashboard = {
  owner_kind: "agent",
  owner_id: "ag1",
  cases_total: 2,
  current: {
    recall: 0.8,
    precision: 0.9,
    citation_accuracy: 1,
    traces_passed: 1,
    traces_total: 2,
    cost_usd: 0.02,
  },
  delta: { recall: 0, precision: 0, citation_accuracy: 0 },
  trend: [],
  recent_runs: [
    {
      id: "run1",
      case_id: "case1",
      case_name: "stripe-key-leak",
      ran_at: "2026-07-15T00:00:00.000Z",
      actual_output: [],
      pass: true,
      recall: 1,
      precision: 1,
      citation_accuracy: 1,
      duration_ms: 1000,
      cost_usd: 0.01,
    },
  ],
  alert: null,
};

function renderWithIntl(ui: React.ReactElement) {
  return render(
    <NextIntlClientProvider locale="en" messages={{ eval: messages }}>
      {ui}
    </NextIntlClientProvider>,
  );
}

describe("EvalsTab", () => {
  it("renders the case list with per-case status and metric cards as number + label", () => {
    casesData = [CASE_1, CASE_2];
    dashboardData = DASHBOARD;

    renderWithIntl(<EvalsTab agentId="ag1" agentName="Security Reviewer" />);

    // Metric cards — number + label, not colour alone.
    expect(screen.getByText("80%")).toBeInTheDocument();
    expect(screen.getByText("90%")).toBeInTheDocument();
    expect(screen.getByText("100%")).toBeInTheDocument();
    expect(screen.getByText("RECALL")).toBeInTheDocument();
    expect(screen.getByText("PRECISION")).toBeInTheDocument();

    // Case list with text status (not colour alone).
    expect(screen.getByText("stripe-key-leak")).toBeInTheDocument();
    expect(screen.getByText("sql-injection")).toBeInTheDocument();
    expect(screen.getByText(/passed/)).toBeInTheDocument();
    expect(screen.getByText("never run")).toBeInTheDocument();
  });

  it("opens the case editor from New eval case and fires the run-set mutation from Run all evals", () => {
    casesData = [CASE_1];
    dashboardData = DASHBOARD;

    renderWithIntl(<EvalsTab agentId="ag1" agentName="Security Reviewer" />);

    fireEvent.click(
      screen.getByRole("button", { name: /Run all evals/ }),
    );
    expect(runSetMutate).toHaveBeenCalledWith("ag1");

    fireEvent.click(
      screen.getByRole("button", { name: /New eval case/ }),
    );
    // The case-editor modal renders its own "Cancel"/"Save" footer once open.
    expect(screen.getByRole("button", { name: /^Save$/ })).toBeInTheDocument();
  });

  it("deletes a case after confirmation, and does nothing if the confirm is dismissed", () => {
    casesData = [CASE_1];
    dashboardData = DASHBOARD;
    const confirmSpy = vi.spyOn(window, "confirm");

    renderWithIntl(<EvalsTab agentId="ag1" agentName="Security Reviewer" />);
    const deleteBtn = screen.getByRole("button", { name: /^Delete$/ });

    confirmSpy.mockReturnValueOnce(false);
    fireEvent.click(deleteBtn);
    expect(deleteCaseMutate).not.toHaveBeenCalled();

    confirmSpy.mockReturnValueOnce(true);
    fireEvent.click(deleteBtn);
    expect(deleteCaseMutate).toHaveBeenCalledWith({ id: "case1", agentId: "ag1" });

    confirmSpy.mockRestore();
  });
});
