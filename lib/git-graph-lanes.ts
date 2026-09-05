/**
 * Lane state machine for the git graph tab.
 *
 * Ported from the validated prototype (.myLastChat/git_graph_charstream_demo.html,
 * vscode-git-graph approach): commit rows only supply hash/parent links, the
 * machine derives columns ("lanes") and edge geometry. Rules:
 * - a commit lands in the first lane whose pending parent is its hash;
 *   duplicate pending lanes for the same hash are released;
 * - the first parent inherits the commit's lane; additional parents open new
 *   lanes to the right (branch edges);
 * - a root commit releases its lane;
 * - `compact` recycles released lanes (product default), `faithful` only grows
 *   rightwards like the git terminal output (kept for verification/tests).
 *
 * Colors are returned as palette indexes so the component can map them to a
 * theme-derived palette.
 */

import type { GitLogCommit } from "./git-graph-parser";

export type GitGraphEdgeKind = "straight" | "branch" | "merge";

export interface GitGraphNode {
  hash: string;
  row: number;
  lane: number;
  colorIndex: number;
}

export interface GitGraphEdge {
  fromRow: number;
  fromLane: number;
  toRow: number;
  toLane: number;
  colorIndex: number;
  kind: GitGraphEdgeKind;
}

export interface GitGraphLayout {
  nodes: GitGraphNode[];
  edges: GitGraphEdge[];
  laneCount: number;
}

export function buildGitGraphLayout(commits: GitLogCommit[], strategy: "compact" | "faithful" = "compact"): GitGraphLayout {
  const lanes: (string | null)[] = [];   // lane -> pending parent hash
  const laneColors: number[] = [];
  const nodes: GitGraphNode[] = [];
  const byHash = new Map<string, GitGraphNode>();
  const edgeRecords: { fromHash: string; toHash: string; colorIndex: number; kind?: GitGraphEdgeKind }[] = [];
  const freeLanes: number[] = [];        // compact strategy's recycle pool
  let maxLane = 0;
  let colorCursor = 0;

  const nextColorIndex = () => colorCursor++;
  const alloc = (): number => {
    if (strategy === "compact" && freeLanes.length > 0) {
      const lane = freeLanes.shift()!;
      laneColors[lane] = nextColorIndex();
      return lane;
    }
    laneColors[maxLane] = nextColorIndex();
    return maxLane++;
  };
  const release = (lane: number) => {
    lanes[lane] = null;
    if (strategy === "compact" && !freeLanes.includes(lane)) freeLanes.push(lane);
  };

  commits.forEach((commit, row) => {
    let lane = lanes.indexOf(commit.hash);
    if (lane < 0) {
      // Defensive: a truncated window can cut a branch's pending entry.
      lane = alloc();
    } else {
      // Clear duplicate pending lanes for the same hash.
      for (let i = lane + 1; i < lanes.length; i++) {
        if (lanes[i] === commit.hash) release(i);
      }
    }
    lanes[lane] = null;
    const node: GitGraphNode = { hash: commit.hash, row, lane, colorIndex: laneColors[lane] };
    nodes.push(node);
    byHash.set(commit.hash, node);

    commit.parents.forEach((parent, index) => {
      const colorIndex = index === 0 ? laneColors[lane] : nextColorIndex();
      if (index > 0 && lanes.indexOf(parent) < 0) {
        const newLane = alloc();
        lanes[newLane] = parent;
        edgeRecords.push({ fromHash: commit.hash, toHash: parent, colorIndex: laneColors[newLane], kind: "branch" });
      } else {
        if (index === 0) lanes[lane] = parent; // first parent inherits the lane
        edgeRecords.push({ fromHash: commit.hash, toHash: parent, colorIndex });
      }
    });

    if (commit.parents.length === 0) release(lane); // root commit frees its lane
  });

  // Resolve edges to geometry; edges pointing outside the window (truncated
  // parents) have no target node and are dropped.
  const edges: GitGraphEdge[] = [];
  for (const record of edgeRecords) {
    const from = byHash.get(record.fromHash);
    const to = byHash.get(record.toHash);
    if (!from || !to) continue;
    edges.push({
      fromRow: from.row,
      fromLane: from.lane,
      toRow: to.row,
      toLane: to.lane,
      colorIndex: record.colorIndex,
      kind: record.kind ?? (from.lane === to.lane ? "straight" : "merge"),
    });
  }

  return { nodes, edges, laneCount: maxLane };
}
