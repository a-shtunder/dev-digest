// Cross-site scripting (A03) — reflecting untrusted input as raw HTML.
import React from "react";

// Renders user-controlled `comment` as raw HTML — stored/reflected XSS.
export function Comment({ comment }: { comment: string }) {
  return <div dangerouslySetInnerHTML={{ __html: comment }} />;
}

// Builds a markup string from a search term with no escaping.
export function highlight(term: string): string {
  return `<mark>${term}</mark>`;
}
