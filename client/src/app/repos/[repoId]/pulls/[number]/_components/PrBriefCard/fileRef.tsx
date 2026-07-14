/* Shared file-ref parsing/link rendering — used by PrBriefCard (risks) and
   ReviewFocusCard (review-focus items). Both render AI-generated `file_ref`
   locators as clickable links into the diff view, so the parse+validate
   logic lives in one place (security: validate ref before use as link). */
"use client";

import React from "react";
import Link from "next/link";

/**
 * Parse a `file_ref`/`file:line` or `file:startLine-endLine` locator into a
 * safe (path, line, endLine?) triple, or `null` if it isn't safe/well-formed.
 * Rejects absolute URLs and non-numeric line segments so AI-generated
 * content can never smuggle a `javascript:` or cross-origin href into the
 * DOM. Mirrors the server's range-aware parser in `modules/brief/helpers.ts`
 * — a bare single-line-only parser here would silently fall back to
 * unclickable plain text for every range ref (`path:start-end`), which the
 * Brief schema explicitly allows (R4).
 */
export function parseFileRef(ref: string): { path: string; line: number; endLine?: number } | null {
  if (!ref || typeof ref !== "string") return null;
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(ref)) return null; // absolute URL (http://, //host)
  if (/^(javascript|data|vbscript):/i.test(ref)) return null;
  const match = /^(.+):(\d+)(?:-(\d+))?$/.exec(ref);
  if (!match) return null;
  const [, path, startStr, endStr] = match;
  if (!path || path.includes("..")) return null;
  const line = Number(startStr);
  return endStr !== undefined ? { path, line, endLine: Number(endStr) } : { path, line };
}

/* Line-anchor mechanism (coordinate with smart-diff/file view): navigates to
   `?tab=diff&line=<n>#file-<path>` — a query param switching to the Diff
   tab, a `line` query param carrying the 1-based (start) line number, and a
   URL hash matching the per-file anchor `SmartDiffViewer.tsx` already wires
   up (`<div id={\`file-${sf.path}\`}>` — file-level only, no per-line id
   yet). For a range ref, `line` carries the range's start. */
export function FileRefLink({ pathname, refStr }: { pathname: string; refStr: string }) {
  const parsed = parseFileRef(refStr);
  if (!parsed) {
    // Not a safe/parseable locator — render as plain text, never as a link.
    return <span style={{ fontSize: 12, color: "var(--text-muted)" }}>{refStr}</span>;
  }
  const href = `${pathname}?tab=diff&line=${parsed.line}#file-${encodeURIComponent(parsed.path)}`;
  return (
    <Link
      href={href}
      className="mono"
      style={{ fontSize: 12, color: "var(--accent)", textDecoration: "underline" }}
    >
      {parsed.path}:{parsed.line}
      {parsed.endLine !== undefined ? `-${parsed.endLine}` : ""}
    </Link>
  );
}
