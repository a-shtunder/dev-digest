import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { FindingRecord } from "@devdigest/shared";
import prReviewMessages from "../../../../../../../../messages/en/prReview.json";
import evalMessages from "../../../../../../../../messages/en/eval.json";
import { ToastProvider } from "../../../../../../../lib/contexts/toast";

vi.mock("../../../../../../../lib/hooks/reviews", () => ({
  useFindingAction: () => ({ mutate: vi.fn(), isPending: false }),
}));

const createEvalCaseMutate = vi.fn();
vi.mock("../../../../../../../lib/hooks/eval", () => ({
  useCreateEvalCaseFromFinding: () => ({
    mutate: createEvalCaseMutate,
    isPending: false,
    variables: undefined,
  }),
}));

import { FindingsPanel } from "./FindingsPanel";

afterEach(cleanup);

const FINDINGS: FindingRecord[] = [
  {
    id: "f1",
    severity: "CRITICAL",
    category: "security",
    title: "Hardcoded secret",
    file: "src/config.ts",
    start_line: 11,
    end_line: 11,
    rationale: "A secret is committed.",
    suggestion: null,
    confidence: 0.95,
    kind: "finding",
    trifecta_components: null,
    evidence: null,
    review_id: "r1",
    accepted_at: null,
    dismissed_at: null,
  },
];

function renderWithIntl(ui: React.ReactElement) {
  return render(
    <NextIntlClientProvider
      locale="en"
      messages={{ prReview: prReviewMessages, eval: evalMessages }}
    >
      <ToastProvider>{ui}</ToastProvider>
    </NextIntlClientProvider>,
  );
}

describe("FindingsPanel (smoke)", () => {
  it("renders the toolbar + a finding card", () => {
    renderWithIntl(<FindingsPanel findings={FINDINGS} prId="pr1" />);
    expect(screen.getByText("Hide low confidence")).toBeInTheDocument();
    expect(screen.getByText("Hardcoded secret")).toBeInTheDocument();
  });

  it("shows the empty state when nothing matches", () => {
    renderWithIntl(<FindingsPanel findings={[]} prId="pr1" />);
    expect(screen.getByText("No findings match")).toBeInTheDocument();
  });

  it("filters by severity when a pill is clicked", () => {
    const findings: FindingRecord[] = [
      { ...FINDINGS[0]! },
      {
        ...FINDINGS[0]!,
        id: "f2",
        severity: "WARNING",
        title: "Warn finding",
      },
    ];
    renderWithIntl(<FindingsPanel findings={findings} prId="pr1" />);
    // Both visible initially
    expect(screen.getByText("Hardcoded secret")).toBeInTheDocument();
    expect(screen.getByText("Warn finding")).toBeInTheDocument();
    // Click CRITICAL pill
    fireEvent.click(screen.getByRole("button", { name: /critical/i }));
    expect(screen.getByText("Hardcoded secret")).toBeInTheDocument();
    expect(screen.queryByText("Warn finding")).not.toBeInTheDocument();
    // Click again → reset
    fireEvent.click(screen.getByRole("button", { name: /critical/i }));
    expect(screen.getByText("Warn finding")).toBeInTheDocument();
  });

  it("shows 'Turn into eval case' only for a decided finding, fires the create mutation, and shows toast feedback", () => {
    createEvalCaseMutate.mockImplementation((_findingId, options) => {
      options?.onSuccess?.();
    });

    const decided: FindingRecord = { ...FINDINGS[0]!, accepted_at: "2026-07-15T00:00:00Z" };
    renderWithIntl(<FindingsPanel findings={[decided]} prId="pr1" />);

    const evalButton = screen.getByRole("button", { name: /turn into eval case/i });
    expect(evalButton).toBeInTheDocument();

    fireEvent.click(evalButton);
    expect(createEvalCaseMutate).toHaveBeenCalledWith(
      "f1",
      expect.objectContaining({ onSuccess: expect.any(Function) }),
    );
    expect(screen.getByText("Eval case created")).toBeInTheDocument();
  });

  it("hides 'Turn into eval case' for an undecided finding", () => {
    renderWithIntl(<FindingsPanel findings={FINDINGS} prId="pr1" />);
    expect(
      screen.queryByRole("button", { name: /turn into eval case/i }),
    ).not.toBeInTheDocument();
  });
});
