/* CodeLine — one rendered diff line: gutter number, +/- sign, text, plus the
   hover "+" affordance, any anchored comment threads, and an inline composer. */
"use client";

import React from "react";
import { Icon, SEV } from "@devdigest/ui";
import type { Severity } from "@devdigest/shared";
import { commentTargetFor, type CommentThread, type DiffCommentApi, cs } from "../comments";
import { type Line } from "../helpers";
import { s, lineRowFor, lineSignFor } from "../styles";
import { CommentThreadView } from "../CommentThreadView";
import { InlineComposer } from "../InlineComposer";

/** i18n label for a severity chip (blocker/warning/suggestion) — Smart Diff only. */
export type SeverityChipLabels = Record<Severity, string>;

export function CodeLine({
  ln,
  path,
  threads,
  commenting,
  severity,
  severityLabels,
}: {
  ln: Line;
  path: string;
  threads: CommentThread[];
  commenting?: DiffCommentApi;
  /** Smart Diff only: severity of a finding anchored to this line (by newNo). Highlights the row + renders an inline chip. No-op when omitted. */
  severity?: Severity;
  /** i18n labels for the inline severity chip (blocker/warning/suggestion). Required together with `severity`. */
  severityLabels?: SeverityChipLabels;
}) {
  const [hover, setHover] = React.useState(false);
  const [composing, setComposing] = React.useState(false);

  if (ln.kind === "hunk") {
    return (
      <div className="mono" style={s.hunk}>
        {ln.text}
      </div>
    );
  }

  const sign = ln.kind === "add" ? "+" : ln.kind === "del" ? "−" : "";
  const target = commenting?.canComment ? commentTargetFor(ln) : null;
  const showAdd = hover && !!target && !composing;
  const sevMeta = severity ? SEV[severity] : null;
  const SevIcon = sevMeta ? Icon[sevMeta.icon] : null;

  return (
    <div
      style={cs.rowWrap}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
    >
      <div
        style={{
          ...lineRowFor(ln.kind),
          // Severity is signalled by a left accent bar + the chip below, not by
          // washing the whole row in colour — keeps the row's own add/del/ctx
          // background as the only "row colour" the reader has to parse.
          borderLeft: sevMeta ? `3px solid ${sevMeta.c}` : "3px solid transparent",
        }}
      >
        <span className="mono tnum" style={{ ...s.lineNo, position: "relative" }}>
          {showAdd && target && (
            <button
              type="button"
              title="Add a comment on this line"
              aria-label="Add a comment on this line"
              onClick={() => setComposing(true)}
              style={cs.addBtn}
            >
              +
            </button>
          )}
          {ln.newNo ?? ln.oldNo ?? ""}
        </span>
        <span className="mono" style={lineSignFor(ln.kind)}>
          {sign}
        </span>
        <span className="mono" style={s.lineText}>
          {ln.text || " "}
        </span>
        {sevMeta && severity && (
          <span
            data-severity-chip={severity}
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 4,
              fontSize: 11,
              fontWeight: 600,
              color: sevMeta.c,
              background: `${sevMeta.c}22`,
              border: `1px solid ${sevMeta.c}55`,
              borderRadius: 4,
              padding: "1px 6px",
              marginRight: 10,
              flexShrink: 0,
              alignSelf: "center",
            }}
          >
            {SevIcon && <SevIcon size={11} style={{ flexShrink: 0 }} />}
            {severityLabels?.[severity] ?? severity}
          </span>
        )}
      </div>

      {commenting &&
        commenting.showComments &&
        threads.map((th) => (
          <CommentThreadView key={th.rootId} thread={th} commenting={commenting} path={path} />
        ))}

      {commenting && composing && target && (
        <InlineComposer
          commenting={commenting}
          path={path}
          line={target.line}
          side={target.side}
          onClose={() => setComposing(false)}
        />
      )}
    </div>
  );
}
