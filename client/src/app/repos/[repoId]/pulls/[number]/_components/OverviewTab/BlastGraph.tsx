/* BlastGraph.tsx — small custom inline SVG node/edge diagram: one center node
   per changed symbol, radiating lines to its caller files. Display-only cap
   at MAX_RENDERED_CALLERS per symbol so a high-fan-in symbol doesn't blow up
   the layout — this never affects the counts/data shown elsewhere in the card.
   Dumb component: renders nothing when there's nothing to draw; the parent
   (BlastRadiusCard) decides when to show the `graph.empty` copy instead.
   Expects `groups` to already be filtered to callers.length > 0 (the parent
   does this once via groupCallersBySymbol + a single filter) — this component
   only keeps a defensive empty check, it does not re-filter. */
"use client";

import React from "react";
import type { BlastSymbolGroup } from "./blastViewModel";

const MAX_RENDERED_CALLERS = 8;
const ROW_HEIGHT = 26;
const ROW_GAP = 36;
const CENTER_X = 90;
const CALLER_X = 320;

function SymbolGraphRow({ group }: { group: BlastSymbolGroup }) {
  const callers = group.callers.slice(0, MAX_RENDERED_CALLERS);
  const height = Math.max(callers.length, 1) * ROW_HEIGHT + 16;
  const centerY = height / 2;

  return (
    <svg width="100%" height={height} viewBox={`0 0 480 ${height}`} role="img">
      {/* edges */}
      {callers.map((caller, i) => {
        const y = ROW_HEIGHT / 2 + i * ROW_HEIGHT + 8;
        return (
          <line
            key={i}
            x1={CENTER_X}
            y1={centerY}
            x2={CALLER_X}
            y2={y}
            stroke="var(--border)"
            strokeWidth={1}
          />
        );
      })}

      {/* center node: the changed symbol */}
      <circle cx={CENTER_X} cy={centerY} r={5} fill="var(--accent)" />
      <text
        x={CENTER_X - 10}
        y={centerY + 4}
        textAnchor="end"
        fontSize={12}
        fontWeight={600}
        fill="var(--text-secondary)"
      >
        {group.symbol.name}
      </text>

      {/* caller nodes */}
      {callers.map((caller, i) => {
        const y = ROW_HEIGHT / 2 + i * ROW_HEIGHT + 8;
        return (
          <g key={i}>
            <circle cx={CALLER_X} cy={y} r={4} fill="var(--text-secondary)" />
            <text x={CALLER_X + 10} y={y + 4} fontSize={11} fill="var(--text-secondary)">
              {caller.file}:{caller.line}
            </text>
          </g>
        );
      })}
    </svg>
  );
}

export function BlastGraph({ groups }: { groups: BlastSymbolGroup[] }) {
  if (groups.length === 0) return null;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: ROW_GAP - ROW_HEIGHT }}>
      {groups.map((group) => (
        <SymbolGraphRow key={`${group.symbol.file}:${group.symbol.name}`} group={group} />
      ))}
    </div>
  );
}
