import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup, within, fireEvent } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { DiscoveredDocument, DiscoverySummary, DocumentContent } from "@devdigest/shared";
import messages from "../../../../../../../messages/en/projectContext.json";

const DOCS: DiscoveredDocument[] = [
  { path: "specs/checkout.md", bucket: "specs", estimated_tokens: 340 },
  { path: "docs/architecture/overview.md", bucket: "docs", estimated_tokens: 120 },
];

const SUMMARY: DiscoverySummary = {
  document_count: 2,
  total_estimated_tokens: 460,
  refreshed_at: new Date().toISOString(),
  clone_available: true,
};

const DOC_CONTENT: DocumentContent = { path: "specs/checkout.md", text: "# Checkout\n\nSome body." };

let saveMutate: ReturnType<typeof vi.fn>;
let saveState: { isPending: boolean; isSuccess: boolean; isError: boolean };
let queryOverride: {
  data: { documents: DiscoveredDocument[]; summary: DiscoverySummary } | undefined;
  isLoading: boolean;
  isError: boolean;
  refetch: () => void;
};

vi.mock("../../../../../../lib/hooks/projectContext", () => ({
  useProjectContext: () => queryOverride,
  useDocument: () => ({ data: DOC_CONTENT, isLoading: false, isError: false }),
  useSaveDocument: () => ({ mutate: saveMutate, ...saveState }),
}));

// AppShell pulls in routing/command-palette chrome unrelated to this page's
// behavior — stub it to a passthrough so tests don't need a Next.js router.
vi.mock("../../../../../../components/app-shell", () => ({
  AppShell: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

import { ProjectContextView } from "./ProjectContextView";

function renderView() {
  return render(
    <NextIntlClientProvider locale="en" messages={{ projectContext: messages }}>
      <ProjectContextView repoId="repo1" />
    </NextIntlClientProvider>,
  );
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("ProjectContextView", () => {
  it("renders the discovery list with bucket badges and the summary footer, previews a doc, edits it, and saves", () => {
    saveMutate = vi.fn();
    saveState = { isPending: false, isSuccess: false, isError: false };
    queryOverride = { data: { documents: DOCS, summary: SUMMARY }, isLoading: false, isError: false, refetch: vi.fn() };
    renderView();

    // List renders filename, folder, and a colour + text bucket badge (never colour alone).
    expect(screen.getByText("checkout.md")).toBeInTheDocument();
    expect(screen.getByText("docs/architecture")).toBeInTheDocument();
    expect(screen.getAllByText("Specs").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Docs").length).toBeGreaterThan(0);

    // Summary footer: count + summed tokens + refreshed time, no chunk/index wording.
    const footer = screen.getByText(/documents/i);
    expect(footer.textContent).toMatch(/2 documents/);
    expect(footer.textContent).toMatch(/460 tokens total/);
    expect(footer.textContent).not.toMatch(/chunk/i);
    expect(footer.textContent).not.toMatch(/index/i);

    // Preview opens the drawer and renders markdown.
    const previewButtons = screen.getAllByRole("button", { name: "Preview" });
    fireEvent.click(previewButtons[0]!);
    const dialog = screen.getByRole("dialog");
    expect(within(dialog).getByText("Checkout")).toBeInTheDocument();

    // Switch to Edit — resync warning is shown, textarea is keyboard operable, Save calls the mutation.
    fireEvent.click(within(dialog).getByRole("button", { name: "Edit" }));
    expect(within(dialog).getByText(/tracked in the repo/i)).toBeInTheDocument();
    const textarea = within(dialog).getByRole("textbox") as HTMLTextAreaElement;
    fireEvent.change(textarea, { target: { value: DOC_CONTENT.text + " More." } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Save" }));
    expect(saveMutate).toHaveBeenCalledWith({ path: "specs/checkout.md", text: DOC_CONTENT.text + " More." });
  });

  it("surfaces a save failure and shows the not-available state when the clone is absent", () => {
    saveMutate = vi.fn();
    saveState = { isPending: false, isSuccess: false, isError: true };
    queryOverride = { data: { documents: DOCS, summary: SUMMARY }, isLoading: false, isError: false, refetch: vi.fn() };
    const { unmount } = renderView();

    fireEvent.click(screen.getAllByRole("button", { name: "Preview" })[0]!);
    fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Edit" }));
    expect(screen.getByText(/Couldn't save this document/i)).toBeInTheDocument();
    unmount();

    queryOverride = {
      data: { documents: [], summary: { ...SUMMARY, clone_available: false } },
      isLoading: false,
      isError: false,
      refetch: vi.fn(),
    };
    renderView();
    expect(screen.getByText("Clone not available")).toBeInTheDocument();
  });
});
