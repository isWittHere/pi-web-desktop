/**
 * Shared edge geometry for git lane graphs.
 *
 * The lane machine (lib/git-graph-lanes.ts) stays geometry-free; this module
 * turns its edges into SVG paths. Both the git-graph tab (large constants,
 * variable row heights) and the @comment: menu's mini graph (compact rows)
 * delegate here so their lines render identically.
 */

import type { GitGraphEdge } from "./git-graph-lanes";

export interface GitGraphEdgeGeometry {
  /** Lane index -> x px. */
  laneX: (lane: number) => number;
  /** Row index -> top y px (cumulative; rows may vary in height). */
  rowTops: number[];
  /** Row index -> height px. */
  rowHeight: (row: number) => number;
  /** Max elbow corner radius in px (clamped by the actual deltas). */
  cornerRadius: number;
}

/**
 * SVG path for one lane edge. Straight when the lane is unchanged; otherwise
 * a rounded elbow — horizontal-out then vertical-in for branch edges (child
 * exits rightwards into a new lane), vertical-out then horizontal-in for
 * merge edges (child's lane folds back into the parent's lane).
 */
export function gitGraphEdgePath(edge: GitGraphEdge, g: GitGraphEdgeGeometry): string {
  const x1 = g.laneX(edge.fromLane);
  const y1 = g.rowTops[edge.fromRow] + g.rowHeight(edge.fromRow) / 2;
  const x2 = g.laneX(edge.toLane);
  const y2 = g.rowTops[edge.toRow] + g.rowHeight(edge.toRow) / 2;
  if (edge.fromLane === edge.toLane) {
    return `M ${x1} ${y1} L ${x2} ${y2}`;
  }
  const dx = x2 > x1 ? 1 : -1;
  const sy = y2 > y1 ? 1 : -1;
  const r = Math.min(g.cornerRadius, Math.abs(x2 - x1) / 2, Math.abs(y2 - y1) / 2);
  if (edge.kind === "branch") {
    // Horizontal out of the child, rounded corner, vertical into the parent.
    return `M ${x1} ${y1} L ${x2 - dx * r} ${y1} Q ${x2} ${y1} ${x2} ${y1 + sy * r} L ${x2} ${y2}`;
  }
  // merge: vertical out of the child's lane, horizontal into the parent.
  return `M ${x1} ${y1} L ${x1} ${y2 - sy * r} Q ${x1} ${y2} ${x1 + dx * r} ${y2} L ${x2} ${y2}`;
}
