import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { Skill } from "@devdigest/shared";
import messages from "../../../../../../../../messages/en/projectContext.json";

const mutateSkillDocs = vi.fn();

// Mock repo resolution — ContextTab discovers docs for the active repo.
vi.mock("@/lib/contexts/repoContext", () => ({
  useActiveRepo: () => ({
    repoId: "repo1",
    activeRepo: { id: "repo1" },
    repos: [],
    setRepoId: vi.fn(),
    reposLoaded: true,
  }),
}));

// Mock data hooks so the tab renders without a network/query client.
vi.mock("@/lib/hooks/projectContext", () => ({
  useProjectContext: () => ({
    data: {
      documents: [
        {
          path: "specs/SPEC-01.md",
          bucket: "specs",
          estimated_tokens: 120,
        },
        {
          path: "docs/architecture.md",
          bucket: "docs",
          estimated_tokens: 80,
        },
      ],
      summary: {
        document_count: 2,
        total_estimated_tokens: 200,
        refreshed_at: new Date().toISOString(),
        clone_available: true,
      },
    },
    isLoading: false,
    isError: false,
    refetch: vi.fn(),
  }),
  useDocument: () => ({ data: undefined, isLoading: false, isError: false }),
  useSetSkillDocs: () => ({ mutate: mutateSkillDocs }),
}));

import { ContextTab } from "./ContextTab";

afterEach(() => {
  cleanup();
  mutateSkillDocs.mockClear();
});

const SKILL: Skill = {
  id: "sk1",
  name: "Security Rubric",
  description: "Flags secrets",
  type: "security",
  source: "manual",
  body: "# Rule",
  enabled: true,
  version: 1,
  evidence_files: null,
  attached_doc_paths: ["specs/SPEC-01.md"],
};

function renderWithIntl(ui: React.ReactElement) {
  return render(
    <NextIntlClientProvider locale="en" messages={{ projectContext: messages }}>
      {ui}
    </NextIntlClientProvider>,
  );
}

describe("T14 Skill Context tab", () => {
  it("renders rows, attached count, search, inheritance note, and the serializes-as preview; toggling persists paths", () => {
    renderWithIntl(<ContextTab skill={SKILL} />);

    // Header count + inheritance note (AC-15)
    expect(screen.getByText("1 attached")).toBeInTheDocument();
    expect(
      screen.getByText("Any agent using this skill inherits these documents."),
    ).toBeInTheDocument();

    // Search box present
    const search = screen.getByPlaceholderText("Filter documents…");
    expect(search).toBeInTheDocument();

    // Both discovered docs render as rows
    expect(screen.getByText("SPEC-01.md")).toBeInTheDocument();
    expect(screen.getByText("architecture.md")).toBeInTheDocument();

    // "Serializes as" contribution preview lists the attached path (AC-17)
    expect(screen.getByText("Serializes as")).toBeInTheDocument();
    expect(screen.getByText(/- specs\/SPEC-01\.md/)).toBeInTheDocument();

    // Attaching the second doc persists the ordered path list via the
    // mutation (AC-16) — never `evidence_files`.
    const rows = screen.getAllByRole("switch");
    fireEvent.click(rows[1]!);
    expect(mutateSkillDocs).toHaveBeenCalledWith({
      paths: ["specs/SPEC-01.md", "docs/architecture.md"],
    });

    // Search narrows the visible rows without discarding attach state.
    fireEvent.change(search, { target: { value: "architecture" } });
    expect(screen.queryByText("SPEC-01.md")).not.toBeInTheDocument();
    expect(screen.getByText("architecture.md")).toBeInTheDocument();
  });
});
