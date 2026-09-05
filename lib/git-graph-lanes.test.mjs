import assert from "node:assert/strict";
import test from "node:test";

import { buildGitGraphLayout } from "./git-graph-lanes.ts";

function commit(hash, parents) {
  return { hash, parents, author: "A", timestamp: 0, subject: hash, refs: [] };
}

// Topology of the prototype's sample history (newest first): a main line with
// two merges, including an octopus merge of two experimental branches.
const DEMO_HISTORY = [
  commit("f541", ["f39b"]),
  commit("f39b", ["315b", "4fac", "857f"]), // octopus merge
  commit("857f", ["d320"]),
  commit("4fac", ["d320"]),
  commit("315b", ["d320"]),
  commit("d320", ["2e32", "9a53"]), // merge
  commit("9a53", ["03f9"]),
  commit("03f9", ["e31e"]),
  commit("2e32", ["e31e"]),
  commit("e31e", ["53bd", "e1a9"]), // merge
  commit("e1a9", ["71ce"]),
  commit("71ce", ["6d92"]),
  commit("53bd", ["6d92"]),
  commit("6d92", ["3519"]),
  commit("3519", []), // root
];

function nodeOf(layout, hash) {
  const node = layout.nodes.find((n) => n.hash === hash);
  assert.ok(node, `node ${hash} missing`);
  return node;
}

test("linear history stays on lane 0 with straight edges", () => {
  const layout = buildGitGraphLayout([
    commit("a", ["b"]),
    commit("b", ["c"]),
    commit("c", []),
  ]);
  assert.deepEqual(layout.nodes.map((n) => n.lane), [0, 0, 0]);
  assert.equal(layout.edges.length, 2);
  for (const edge of layout.edges) {
    assert.equal(edge.kind, "straight");
    assert.equal(edge.fromLane, 0);
    assert.equal(edge.toLane, 0);
  }
  assert.equal(layout.laneCount, 1);
});

test("the prototype history lays out merges, branches and the root correctly", () => {
  const layout = buildGitGraphLayout(DEMO_HISTORY, "compact");

  // Rows follow input order.
  assert.deepEqual(layout.nodes.map((n) => n.row), layout.nodes.map((_, i) => i));

  // The octopus merge's extra parents open lanes 1 and 2.
  assert.equal(nodeOf(layout, "f39b").lane, 0);
  assert.equal(nodeOf(layout, "4fac").lane, 1);
  assert.equal(nodeOf(layout, "857f").lane, 2);

  // The merge target converges back onto the main lane.
  assert.equal(nodeOf(layout, "d320").lane, 0);
  assert.equal(nodeOf(layout, "3519").lane, 0);

  const octopusBranch = layout.edges.find(
    (e) => layout.nodes[e.fromRow].hash === "f39b" && layout.nodes[e.toRow].hash === "857f",
  );
  assert.ok(octopusBranch, "f39b->857f edge missing");
  assert.equal(octopusBranch.kind, "branch");

  const f541ToF39b = layout.edges.find((e) => layout.nodes[e.fromRow].hash === "f541");
  assert.equal(f541ToF39b.kind, "straight");

  const fourFacToD320 = layout.edges.find(
    (e) => layout.nodes[e.fromRow].hash === "4fac" && layout.nodes[e.toRow].hash === "d320",
  );
  assert.equal(fourFacToD320.kind, "merge");
  assert.equal(fourFacToD320.fromLane, 1);
  assert.equal(fourFacToD320.toLane, 0);

  // Compact recycles lanes: three lanes suffice for the whole history.
  assert.equal(layout.laneCount, 3);
  // Every lane stays in bounds and colors are palette indexes.
  for (const node of layout.nodes) {
    assert.ok(node.lane >= 0 && node.lane < layout.laneCount);
    assert.ok(Number.isInteger(node.colorIndex) && node.colorIndex >= 0);
  }
});

test("faithful never recycles lanes while compact does", () => {
  const compact = buildGitGraphLayout(DEMO_HISTORY, "compact");
  const faithful = buildGitGraphLayout(DEMO_HISTORY, "faithful");
  assert.ok(faithful.laneCount > compact.laneCount);
});

test("edges to parents outside the truncated window are dropped", () => {
  const layout = buildGitGraphLayout([commit("a", ["missing-parent"])]);
  assert.equal(layout.nodes.length, 1);
  assert.equal(layout.edges.length, 0);
});

test("an empty history yields an empty layout", () => {
  assert.deepEqual(buildGitGraphLayout([]), { nodes: [], edges: [], laneCount: 0 });
});
