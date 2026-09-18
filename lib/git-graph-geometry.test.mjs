import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url);

async function loadSubject() {
  return jiti.import("./git-graph-geometry.ts");
}

// Compact-menu-like geometry: 24px rows, 14px lanes, 6px pads, r=6.
const geometry = {
  laneX: (lane) => 6 + lane * 14 + 7,
  rowTops: [0, 24, 48],
  rowHeight: () => 24,
  cornerRadius: 6,
};

test("same-lane edges render as a straight line", async () => {
  const { gitGraphEdgePath } = await loadSubject();
  const d = gitGraphEdgePath({ fromRow: 0, fromLane: 0, toRow: 1, toLane: 0, colorIndex: 0, kind: "straight" }, geometry);
  assert.equal(d, "M 13 12 L 13 36");
});

test("branch edges elbow horizontally-out then vertically-in", async () => {
  const { gitGraphEdgePath } = await loadSubject();
  const d = gitGraphEdgePath({ fromRow: 0, fromLane: 0, toRow: 1, toLane: 1, colorIndex: 1, kind: "branch" }, geometry);
  assert.equal(d, "M 13 12 L 21 12 Q 27 12 27 18 L 27 36");
});

test("merge edges elbow vertically-out then horizontally-in", async () => {
  const { gitGraphEdgePath } = await loadSubject();
  const d = gitGraphEdgePath({ fromRow: 0, fromLane: 1, toRow: 1, toLane: 0, colorIndex: 0, kind: "merge" }, geometry);
  assert.equal(d, "M 27 12 L 27 30 Q 27 36 21 36 L 13 36");
});

test("corner radius clamps to half the lane delta", async () => {
  const { gitGraphEdgePath } = await loadSubject();
  // Adjacent lanes with a large cornerRadius: r is clamped to 14/2 = 7.
  const d = gitGraphEdgePath({ fromRow: 0, fromLane: 0, toRow: 1, toLane: 1, colorIndex: 1, kind: "branch" }, {
    ...geometry,
    cornerRadius: 20,
  });
  assert.equal(d, "M 13 12 L 20 12 Q 27 12 27 19 L 27 36");
});

test("upward edges (render order differs) flip the vertical sign", async () => {
  const { gitGraphEdgePath } = await loadSubject();
  // Row 2 branches into a lane that resolves on row 1 above it.
  const d = gitGraphEdgePath({ fromRow: 2, fromLane: 0, toRow: 1, toLane: 1, colorIndex: 1, kind: "merge" }, geometry);
  assert.equal(d, "M 13 60 L 13 42 Q 13 36 19 36 L 27 36");
});
