import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { EvalOverview, EvalDashboard, EvalRunRecord } from "@devdigest/shared";
import messages from "../../../../../messages/en/eval.json";

const RUN_A: EvalRunRecord = {
  id: "run-1",
  case_id: "case-1",
  case_name: "stripe-key-leak",
  agent_id: "agent-1",
  ran_at: "2026-07-01T10:00:00.000Z",
  actual_output: null,
  pass: true,
  recall: 0.9,
  precision: 0.8,
  citation_accuracy: 1,
  duration_ms: 1200,
  cost_usd: 0.02,
};

const RUN_B: EvalRunRecord = {
  ...RUN_A,
  id: "run-2",
  ran_at: "2026-07-02T10:00:00.000Z",
  recall: 0.95,
};

const OVERVIEW: EvalOverview = {
  agents: [
    {
      agent_id: "agent-1",
      name: "Security Reviewer",
      recall: 0.9,
      precision: 0.8,
      citation_accuracy: 1,
      traces_passed: 8,
      traces_total: 10,
      trend: [
        { ran_at: "2026-07-01T10:00:00.000Z", recall: 0.85, precision: 0.75, citation_accuracy: 0.9, pass_rate: 0.8, cost_usd: 0.02 },
        { ran_at: "2026-07-02T10:00:00.000Z", recall: 0.9, precision: 0.8, citation_accuracy: 1, pass_rate: 0.9, cost_usd: 0.02 },
      ],
    },
    {
      agent_id: "agent-2",
      name: "Style Reviewer",
      recall: 0,
      precision: 0,
      citation_accuracy: 0,
      traces_passed: 0,
      traces_total: 0,
      trend: [],
    },
  ],
  recent_runs: [RUN_A],
};

const AGENT_DASHBOARD: EvalDashboard = {
  owner_kind: "agent",
  owner_id: "agent-1",
  cases_total: 3,
  current: { recall: 0.9, precision: 0.8, citation_accuracy: 1, traces_passed: 8, traces_total: 10, cost_usd: 0.02 },
  delta: { recall: 0.05, precision: 0.05, citation_accuracy: 0.1 },
  trend: OVERVIEW.agents[0]!.trend,
  recent_runs: [RUN_A, RUN_B],
  alert: null,
};

let workspaceData: { data: EvalOverview | undefined; isLoading: boolean; isError: boolean; refetch: () => void };
let agentData: { data: EvalDashboard | undefined; isLoading: boolean; isError: boolean; refetch: () => void };
const runSetMutate = vi.fn();

vi.mock("@/lib/hooks/eval", () => ({
  useEvalWorkspaceDashboard: () => workspaceData,
  useEvalAgentDashboard: () => agentData,
  useRunEvalSet: () => ({ mutate: runSetMutate, isPending: false }),
}));

vi.mock("@/components/app-shell", () => ({
  AppShell: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

let compareRunsProps: { agentId: string; runs: [EvalRunRecord, EvalRunRecord] } | null = null;
vi.mock("../CompareRuns", () => ({
  CompareRuns: (props: { agentId: string; runs: [EvalRunRecord, EvalRunRecord]; onClose: () => void }) => {
    compareRunsProps = { agentId: props.agentId, runs: props.runs };
    return <div role="dialog">compare-runs-stub</div>;
  },
}));

import { EvalDashboardView } from "./EvalDashboardView";

function renderView() {
  return render(
    <NextIntlClientProvider locale="en" messages={{ eval: messages }}>
      <EvalDashboardView />
    </NextIntlClientProvider>,
  );
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  compareRunsProps = null;
});

describe("EvalDashboardView", () => {
  it("lists agents with metrics + sparkline, shows an empty state for an agent with no runs, and drills in", () => {
    workspaceData = { data: OVERVIEW, isLoading: false, isError: false, refetch: vi.fn() };
    agentData = { data: AGENT_DASHBOARD, isLoading: false, isError: false, refetch: vi.fn() };
    renderView();

    // Agent with runs: name + numeric metrics + labels (number+label, not colour alone).
    expect(screen.getByText("Security Reviewer")).toBeInTheDocument();
    expect(screen.getAllByText("90%").length).toBeGreaterThan(0);
    expect(screen.getAllByText("80%").length).toBeGreaterThan(0);
    expect(screen.getByText("RECALL")).toBeInTheDocument();
    expect(screen.getByText("PRECISION")).toBeInTheDocument();
    // Sparkline renders as an inline SVG for the agent with runs.
    expect(document.querySelector("svg")).toBeInTheDocument();

    // Agent with zero runs shows a neutral empty state, no metric numbers for it.
    expect(screen.getByText("Style Reviewer")).toBeInTheDocument();
    expect(screen.getByText("No runs yet")).toBeInTheDocument();

    // Clicking the agent card drills in: large metric cards + recent runs table.
    fireEvent.click(screen.getByText("Security Reviewer"));
    expect(screen.getByRole("heading", { name: "Security Reviewer" })).toBeInTheDocument();

    // Selecting exactly two runs enables Compare, and clicking it opens the T14 modal
    // with the selected run pair.
    const checkboxes = screen.getAllByRole("checkbox");
    expect(checkboxes).toHaveLength(2);
    fireEvent.click(checkboxes[0]!);
    fireEvent.click(checkboxes[1]!);
    const compareBtn = screen.getByRole("button", { name: "Compare selected" });
    expect(compareBtn).toBeEnabled();
    fireEvent.click(compareBtn);

    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(compareRunsProps?.agentId).toBe("agent-1");
    expect(compareRunsProps?.runs.map((r) => r.id).sort()).toEqual(["run-1", "run-2"]);
  });

  it("clicking a run in the workspace recent-runs table drills into its agent with that run highlighted", () => {
    workspaceData = { data: OVERVIEW, isLoading: false, isError: false, refetch: vi.fn() };
    agentData = { data: AGENT_DASHBOARD, isLoading: false, isError: false, refetch: vi.fn() };
    renderView();

    // The recent-runs table row (not the agent card) is the entry point here.
    // Match on the case name only — the ran_at portion is locale-formatted and
    // shouldn't be baked into the assertion.
    fireEvent.click(screen.getByText(/stripe-key-leak/));

    // Drilled straight into the run's agent.
    expect(screen.getByRole("heading", { name: "Security Reviewer" })).toBeInTheDocument();

    // Exactly one row in the drill-in's own recent-runs table is highlighted —
    // the one matching the run that was clicked (run-1).
    const rows = document.querySelectorAll("tbody tr");
    expect(rows).toHaveLength(2);
    const highlighted = Array.from(rows).filter(
      (r) => (r as HTMLElement).style.outline === "1px solid var(--accent)",
    );
    expect(highlighted).toHaveLength(1);
  });

  it("shows an empty state when the workspace has no review agents", () => {
    workspaceData = {
      data: { agents: [], recent_runs: [] },
      isLoading: false,
      isError: false,
      refetch: vi.fn(),
    };
    agentData = { data: undefined, isLoading: false, isError: false, refetch: vi.fn() };
    renderView();

    expect(screen.getByText(/No review agents yet/i)).toBeInTheDocument();
  });
});
