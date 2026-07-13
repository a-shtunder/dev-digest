import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { FindingRecord, PrFile, SmartDiff } from "@devdigest/shared";
import shellMessages from "../../../messages/en/shell.json";
import briefCardMessages from "../../../messages/en/brief-card.json";

const push = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push, replace: vi.fn() }),
  usePathname: () => "/repos/r1/pulls/42",
  useSearchParams: () => new URLSearchParams(),
}));

// core_summaries is mutable per-test via this holder — mocked at the hook
// boundary (`useBrief`) instead of the network, matching how the rest of the
// hint's data (the Brief) is already fetched/cached elsewhere on the PR page.
let mockCoreSummaries: Record<string, string> = {};
vi.mock("@/lib/hooks", () => ({
  useBrief: () => ({ data: { core_summaries: mockCoreSummaries } }),
}));

import { SmartDiffViewer } from "./SmartDiffViewer";

afterEach(() => {
  cleanup();
  push.mockClear();
  mockCoreSummaries = {};
});

const FILES: PrFile[] = [
  {
    path: "src/payments/webhook-processor.ts",
    // additions+deletions > AUTO_EXPAND_MAX_LINES (200) so the file starts
    // collapsed — needed to prove the findings badge actually opens it.
    additions: 220,
    deletions: 10,
    patch:
      "@@ -1,3 +1,4 @@\n context line\n+const secret = \"hardcoded\";\n context line",
  },
  {
    path: "src/payments/ledger.ts",
    additions: 20,
    deletions: 0,
    patch: "@@ -1,2 +1,2 @@\n-old ledger line\n+new ledger line",
  },
  {
    path: "pnpm-lock.yaml",
    additions: 84,
    deletions: 0,
    patch: "@@ -1,1 +1,2 @@\n context\n+lockfile entry",
  },
];

const SMART_DIFF: SmartDiff = {
  groups: [
    {
      role: "core",
      files: [
        {
          path: "src/payments/webhook-processor.ts",
          pseudocode_summary: "Verifies the webhook signature and dispatches to the ledger.",
          additions: 220,
          deletions: 10,
          finding_lines: [2],
        },
        {
          path: "src/payments/ledger.ts",
          pseudocode_summary: null,
          additions: 20,
          deletions: 0,
          finding_lines: [],
        },
      ],
    },
    {
      role: "boilerplate",
      files: [
        {
          path: "pnpm-lock.yaml",
          pseudocode_summary: null,
          additions: 84,
          deletions: 0,
          finding_lines: [],
        },
      ],
    },
  ],
  split_suggestion: { too_big: false, total_lines: 254, proposed_splits: [] },
};

const FINDINGS: FindingRecord[] = [
  {
    id: "f-1",
    severity: "CRITICAL",
    category: "security",
    title: "Hardcoded webhook signing secret",
    file: "src/payments/webhook-processor.ts",
    start_line: 2,
    end_line: 2,
    rationale: "A secret is committed in source.",
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
      messages={{ shell: shellMessages, "brief-card": briefCardMessages }}
    >
      {ui}
    </NextIntlClientProvider>,
  );
}

describe("SmartDiffViewer", () => {
  it("renders the header stats line computed from smartDiff files", () => {
    const { container } = renderWithIntl(
      <SmartDiffViewer files={FILES} smartDiff={SMART_DIFF} findings={FINDINGS} />,
    );
    expect(screen.getByText("REVIEWER-ORDERED DIFF")).toBeInTheDocument();
    // 3 files, +324 (220+20+84), -10 (10+0+0). Target the stats line's own
    // element (not the whole container's flattened text) — CodeLine's line-gutter
    // spans reuse the same "mono tnum" class, and adjacent badges/counts can
    // concatenate with no separating whitespace in flattened textContent, so a
    // whole-container substring/regex match is unreliable.
    const statsEl = container.querySelector(".mono.tnum");
    expect(statsEl?.textContent).toContain("3 files");
    expect(statsEl?.textContent).toContain("+324");
    expect(statsEl?.textContent).toMatch(/10$/);
  });

  it("renders the core group above the boilerplate group", () => {
    const { container } = renderWithIntl(
      <SmartDiffViewer files={FILES} smartDiff={SMART_DIFF} findings={FINDINGS} />,
    );
    const text = container.textContent ?? "";
    expect(text.indexOf("Core logic")).toBeGreaterThanOrEqual(0);
    expect(text.indexOf("Boilerplate")).toBeGreaterThan(text.indexOf("Core logic"));
  });

  it("starts the boilerplate group collapsed (its file is not rendered)", () => {
    renderWithIntl(<SmartDiffViewer files={FILES} smartDiff={SMART_DIFF} findings={FINDINGS} />);
    expect(screen.queryByText("pnpm-lock.yaml")).not.toBeInTheDocument();
    expect(screen.getByText("Boilerplate")).toBeInTheDocument();
  });

  it("expands the boilerplate group on click, revealing its file", () => {
    renderWithIntl(<SmartDiffViewer files={FILES} smartDiff={SMART_DIFF} findings={FINDINGS} />);
    fireEvent.click(screen.getByText("Boilerplate"));
    expect(screen.getByText("pnpm-lock.yaml")).toBeInTheDocument();
  });

  it("renders a findings badge only for files with finding_lines", () => {
    renderWithIntl(<SmartDiffViewer files={FILES} smartDiff={SMART_DIFF} findings={FINDINGS} />);
    // webhook-processor.ts has 1 finding_line -> badge
    expect(screen.getByText("1 findings")).toBeInTheDocument();
  });

  it("clicking the findings badge opens the file", () => {
    renderWithIntl(<SmartDiffViewer files={FILES} smartDiff={SMART_DIFF} findings={FINDINGS} />);
    // The file starts closed (230 changed lines > AUTO_EXPAND_MAX_LINES=200).
    expect(screen.queryByText('const secret = "hardcoded";')).not.toBeInTheDocument();
    fireEvent.click(screen.getByText("1 findings"));
    expect(screen.getByText('const secret = "hardcoded";')).toBeInTheDocument();
  });

  it("clicking the findings badge navigates to the Findings tab deep-linked to that finding", () => {
    renderWithIntl(<SmartDiffViewer files={FILES} smartDiff={SMART_DIFF} findings={FINDINGS} />);
    fireEvent.click(screen.getByText("1 findings"));
    expect(push).toHaveBeenCalledWith("/repos/r1/pulls/42?tab=findings&finding=f-1");
  });

  it("renders an inline severity chip labelled 'blocker' for a CRITICAL finding", () => {
    renderWithIntl(<SmartDiffViewer files={FILES} smartDiff={SMART_DIFF} findings={FINDINGS} />);
    fireEvent.click(screen.getByText("1 findings"));
    expect(screen.getByText("blocker")).toBeInTheDocument();
  });

  it("renders the AI-generated hint for a core file with a Brief core_summaries entry", () => {
    mockCoreSummaries = {
      "src/payments/webhook-processor.ts": "Verifies the webhook signature and dispatches to the ledger.",
    };
    renderWithIntl(<SmartDiffViewer files={FILES} smartDiff={SMART_DIFF} findings={FINDINGS} prId="pr-1" />);
    expect(
      screen.getByText("Verifies the webhook signature and dispatches to the ledger.", { exact: false }),
    ).toBeInTheDocument();
    expect(screen.getByText("What this does:", { exact: false })).toBeInTheDocument();
    expect(screen.getByText("AI-generated")).toBeInTheDocument();
  });

  it("renders no hint for a core file absent from core_summaries", () => {
    mockCoreSummaries = {};
    renderWithIntl(<SmartDiffViewer files={FILES} smartDiff={SMART_DIFF} findings={FINDINGS} prId="pr-1" />);
    expect(screen.queryByText("What this does:", { exact: false })).not.toBeInTheDocument();
    expect(screen.queryByText("AI-generated")).not.toBeInTheDocument();
  });

  it("renders no hint for a wiring/boilerplate file even when core_summaries has an entry for it", () => {
    mockCoreSummaries = { "pnpm-lock.yaml": "Should never render — this file is boilerplate." };
    renderWithIntl(<SmartDiffViewer files={FILES} smartDiff={SMART_DIFF} findings={FINDINGS} prId="pr-1" />);
    // Expand the boilerplate group first (collapsed by default).
    fireEvent.click(screen.getByText("Boilerplate"));
    expect(screen.getByText("pnpm-lock.yaml")).toBeInTheDocument();
    expect(screen.queryByText("Should never render — this file is boilerplate.")).not.toBeInTheDocument();
  });

  it("renders the split_suggestion banner only when too_big is true", () => {
    renderWithIntl(<SmartDiffViewer files={FILES} smartDiff={SMART_DIFF} findings={FINDINGS} />);
    expect(screen.queryByText(/changed lines/)).not.toBeInTheDocument();

    const tooBig: SmartDiff = {
      ...SMART_DIFF,
      split_suggestion: { too_big: true, total_lines: 600, proposed_splits: [] },
    };
    renderWithIntl(<SmartDiffViewer files={FILES} smartDiff={tooBig} findings={FINDINGS} />);
    expect(screen.getByText(/600 changed lines/)).toBeInTheDocument();
  });
});
