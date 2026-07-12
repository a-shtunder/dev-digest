import type { IconName } from "@devdigest/ui";
import type { DiscoveredDocumentBucket } from "@devdigest/shared";

/** Colour + icon per discovery bucket. A text label always accompanies the
    colour in the UI (WCAG 2.1 AA — never colour alone). */
export const BUCKET_META: Record<
  DiscoveredDocumentBucket,
  { color: string; bg: string; icon: IconName }
> = {
  specs: { color: "var(--accent)", bg: "var(--accent-bg)", icon: "FileText" },
  docs: { color: "var(--info)", bg: "var(--info-bg)", icon: "Folder" },
  insights: { color: "var(--warn)", bg: "var(--warn-bg)", icon: "Lightbulb" },
};

/** Split a repo-relative doc path into folder + filename for display. */
export function splitPath(path: string): { folder: string; filename: string } {
  const idx = path.lastIndexOf("/");
  if (idx === -1) return { folder: "", filename: path };
  return { folder: path.slice(0, idx), filename: path.slice(idx + 1) };
}

/** Compact relative time for the summary footer (e.g. "2m ago", "3h ago"). */
export function relativeTimeAgo(iso: string | null | undefined): string {
  if (!iso) return "—";
  const then = Date.parse(iso);
  if (Number.isNaN(then)) return "—";
  const s = Math.max(0, Math.round((Date.now() - then) / 1000));
  if (s < 60) return "just now";
  const m = Math.round(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.round(h / 24)}d ago`;
}
