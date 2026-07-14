/**
 * PrBriefCard — walks empty (Generate CTA, no auto-fetch of generation),
 * loaded (risk level as text+color, review-focus click → file:line
 * navigation), and error+Retry states (AC-12, AC-18/AC-7 US-7, AC-20, AC-21,
 * AC-22). Also covers ReviewRunOverview being hidden when there is no
 * completed run (AC-23..26) — colocated here per the task's test ownership.
 */
import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { PrBriefResponse, ReviewRecord } from "@devdigest/shared";
import briefCardMessages from "../../../../../../../../messages/en/brief-card.json";
import prReviewMessages from "../../../../../../../../messages/en/prReview.json";

vi.mock("next/navigation", () => ({
  usePathname: () => "/repos/r1/pulls/42",
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}));

let mockBrief: { data?: PrBriefResponse; isLoading: boolean; isError: boolean; refetch: () => void };
const refetch = vi.fn();
const generateMutate = vi.fn();
vi.mock("@/lib/hooks/brief", () => ({
  useBrief: () => mockBrief,
  useGenerateBrief: () => ({ mutate: generateMutate, isPending: false }),
}));

let mockReviews: ReviewRecord[] | undefined;
vi.mock("@/lib/hooks/reviews", () => ({
  usePrReviews: () => ({ data: mockReviews }),
  usePrRuns: () => ({ data: [] }),
}));

import { PrBriefCard } from "./PrBriefCard";
import { ReviewRunOverview } from "../ReviewRunOverview/ReviewRunOverview";
import { ReviewFocusCard } from "../ReviewFocusCard/ReviewFocusCard";

afterEach(() => {
  cleanup();
  refetch.mockClear();
  generateMutate.mockClear();
  mockReviews = undefined;
});

function renderWithIntl(ui: React.ReactElement) {
  return render(
    <NextIntlClientProvider locale="en" messages={{ "brief-card": briefCardMessages, prReview: prReviewMessages }}>
      {ui}
    </NextIntlClientProvider>,
  );
}

const BRIEF: PrBriefResponse = {
  brief: {
    what: "Adds retry logic to the payments webhook",
    why: "Webhook drops events under load",
    risk_level: "high",
    risks: [
      {
        kind: "reliability",
        title: "Retry loop can double-charge",
        explanation: "No idempotency key on retry.",
        severity: "high",
        file_refs: ["src/payments/webhook.ts:42"],
      },
    ],
    review_focus: [
      { label: "Idempotency", file_ref: "src/payments/webhook.ts:42", reason: "Check retry safety" },
    ],
  },
  core_summaries: {},
  head_sha: "abc123",
  generated: true,
};

function review(o: Partial<ReviewRecord> = {}): ReviewRecord {
  return {
    id: "rev-1",
    pr_id: "pr-1",
    agent_id: "a1",
    run_id: "run-1",
    agent_name: "Security Reviewer",
    kind: "review",
    verdict: "request_changes",
    summary: "Found issues",
    score: 62,
    model: "gpt-4.1",
    grounding: "3/3 passed",
    created_at: "2026-07-10T00:00:00.000Z",
    findings: [
      {
        id: "f1",
        review_id: "rev-1",
        accepted_at: null,
        dismissed_at: null,
        title: "Missing idempotency key",
        rationale: "x",
        severity: "CRITICAL",
        category: "bug",
        kind: "finding",
        file: "src/payments/webhook.ts",
        start_line: 42,
        end_line: 42,
        confidence: 0.9,
      },
    ],
    ...o,
  };
}

describe("PrBriefCard", () => {
  it("empty state shows the Generate CTA and never auto-fetches generation", () => {
    mockBrief = { data: undefined, isLoading: false, isError: false, refetch };
    renderWithIntl(<PrBriefCard prId="pr-1" />);

    expect(screen.getByText("No brief available yet for this PR.")).toBeInTheDocument();
    expect(generateMutate).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "Generate brief" }));
    expect(generateMutate).toHaveBeenCalledTimes(1);
  });

  it("loading state shows skeletons, not content", () => {
    mockBrief = { data: undefined, isLoading: true, isError: false, refetch };
    renderWithIntl(<PrBriefCard prId="pr-1" />);
    expect(screen.queryByText("No brief available yet for this PR.")).not.toBeInTheDocument();
  });

  it("error state shows Retry and refetches on click", () => {
    mockBrief = { data: undefined, isLoading: false, isError: true, refetch };
    renderWithIntl(<PrBriefCard prId="pr-1" />);

    expect(screen.getByText("Failed to load the brief.")).toBeInTheDocument();
    const retryBtn = screen.getByRole("button", { name: "Retry" });
    fireEvent.click(retryBtn);
    expect(refetch).toHaveBeenCalledTimes(1);
  });

  it("loaded state shows the risk level as text+color and a risk file_ref link navigating to file:line", () => {
    mockBrief = { data: BRIEF, isLoading: false, isError: false, refetch };
    renderWithIntl(<PrBriefCard prId="pr-1" />);

    // Risk level conveyed via visible text, not color alone.
    expect(screen.getByText("High")).toBeInTheDocument();
    expect(screen.getByText(BRIEF.brief.what)).toBeInTheDocument();
    expect(screen.getByText(BRIEF.brief.why)).toBeInTheDocument();

    const link = screen.getByRole("link", { name: "src/payments/webhook.ts:42" });
    expect(link).toHaveAttribute(
      "href",
      "/repos/r1/pulls/42?tab=diff&line=42#file-src%2Fpayments%2Fwebhook.ts",
    );
    fireEvent.click(link);
  });

  it("loaded state does not render a review-focus section (moved to ReviewFocusCard)", () => {
    mockBrief = { data: BRIEF, isLoading: false, isError: false, refetch };
    renderWithIntl(<PrBriefCard prId="pr-1" />);
    expect(screen.queryByText("Review focus — read these first")).not.toBeInTheDocument();
  });
});

describe("ReviewFocusCard", () => {
  it("renders nothing when there's no brief yet", () => {
    mockBrief = { data: undefined, isLoading: false, isError: false, refetch };
    const { container } = renderWithIntl(<ReviewFocusCard prId="pr-1" />);
    expect(container).toBeEmptyDOMElement();
  });

  it("renders a titled, full-width section with clickable review-focus items", () => {
    mockBrief = { data: BRIEF, isLoading: false, isError: false, refetch };
    renderWithIntl(<ReviewFocusCard prId="pr-1" />);

    expect(screen.getByText("Review focus — read these first")).toBeInTheDocument();
    expect(screen.getByText("Idempotency")).toBeInTheDocument();
    const link = screen.getByRole("link", { name: "src/payments/webhook.ts:42" });
    expect(link).toHaveAttribute(
      "href",
      "/repos/r1/pulls/42?tab=diff&line=42#file-src%2Fpayments%2Fwebhook.ts",
    );
  });

  it("renders a range file_ref (path:start-end) as a clickable link, not plain text", () => {
    mockBrief = {
      data: {
        ...BRIEF,
        brief: {
          ...BRIEF.brief,
          review_focus: [
            { label: "Config", file_ref: "vite.config.ts:1-22", reason: "Check allowed hosts" },
          ],
        },
      },
      isLoading: false,
      isError: false,
      refetch,
    };
    renderWithIntl(<ReviewFocusCard prId="pr-1" />);

    const link = screen.getByRole("link", { name: "vite.config.ts:1-22" });
    expect(link).toHaveAttribute(
      "href",
      "/repos/r1/pulls/42?tab=diff&line=1#file-vite.config.ts",
    );
  });
});

describe("ReviewRunOverview", () => {
  it("is hidden (renders nothing) when there is no completed run", () => {
    mockReviews = [];
    const { container } = renderWithIntl(<ReviewRunOverview prId="pr-1" />);
    expect(container).toBeEmptyDOMElement();
  });

  it("shows verdict, score, and per-severity counts for the latest completed run", () => {
    mockReviews = [review()];
    renderWithIntl(<ReviewRunOverview prId="pr-1" />);
    expect(screen.getByText("Request changes")).toBeInTheDocument();
    expect(screen.getByText("62")).toBeInTheDocument(); // CircularScore
    expect(screen.getByText("1")).toBeInTheDocument(); // CRITICAL count
  });
});
