"use client";

import type { GitGraphLayout } from "@/lib/git-graph-lanes";
import { gitGraphEdgePath } from "@/lib/git-graph-geometry";

// Compact geometry for the @comment: menu's mini lane graph — the same lane
// machine and accent palette as the git-graph tab, with tighter constants for
// 24px rows. The SVG paints above the row hover/selection backgrounds (like
// the tab's layering) but never overlaps text: rows pad left by the graph
// width.
const COL_W = 14;
const PAD_LEFT = 6;
const PAD_RIGHT = 6;
const NODE_R = 3.5;
const HEAD_NODE_R = 4.5;
const CORNER_R = 6;

export const MINI_ROW_H = 24;

export function miniLaneGraphWidth(laneCount: number): number {
  return PAD_LEFT + Math.max(laneCount - 1, 0) * COL_W + COL_W / 2 + PAD_RIGHT;
}

interface Props {
  /** Layout over the same commit list the rows render, same order. */
  layout: GitGraphLayout;
  /** Accent-derived lane palette (same derivation as the git-graph tab). */
  palette: string[];
}

export function MiniLaneGraph({ layout, palette }: Props) {
  const rowTops = layout.nodes.map((_, index) => index * MINI_ROW_H);
  const laneX = (lane: number) => PAD_LEFT + lane * COL_W + COL_W / 2;
  const geometry = { laneX, rowTops, rowHeight: () => MINI_ROW_H, cornerRadius: CORNER_R };
  const laneColor = (colorIndex: number) => palette[colorIndex % palette.length];
  return (
    <svg
      width={miniLaneGraphWidth(layout.laneCount)}
      height={rowTops.length * MINI_ROW_H}
      style={{ position: "absolute", top: 0, left: 0, zIndex: 1, pointerEvents: "none", display: "block" }}
      aria-hidden="true"
    >
      {layout.edges.map((edge, index) => (
        <path
          key={`edge-${index}`}
          d={gitGraphEdgePath(edge, geometry)}
          fill="none"
          stroke={laneColor(edge.colorIndex)}
          strokeWidth={1.5}
        />
      ))}
      {layout.nodes.map((node) => {
        // The newest commit wears the ring treatment of the tab's HEAD node.
        const isHead = node.row === 0;
        return (
          <circle
            key={`node-${node.hash}`}
            cx={laneX(node.lane)}
            cy={rowTops[node.row] + MINI_ROW_H / 2}
            r={isHead ? HEAD_NODE_R : NODE_R}
            fill={isHead ? "var(--bg)" : laneColor(node.colorIndex)}
            stroke={isHead ? laneColor(node.colorIndex) : "var(--bg)"}
            strokeWidth={isHead ? 1.5 : 1}
          />
        );
      })}
    </svg>
  );
}
