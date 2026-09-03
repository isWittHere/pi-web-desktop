import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, {
  jsx: { runtime: "automatic" },
  tsconfigPaths: true,
});
const { buildActivePath, hasBranch } = await jiti.import("./BranchNavigator.tsx");

// Build a linear chain of `n` nodes (each child is the previous one).
function linearTree(n) {
  const nodes = [];
  let prev = null;
  for (let i = 0; i < n; i++) {
    const entry = { type: "message", id: `e${i}`, parentId: prev, timestamp: "t", message: { role: "user", content: `m${i}` } };
    nodes.push({ entry, children: [] });
    if (prev) nodes[nodes.length - 2].children = [nodes[nodes.length - 1]];
    prev = `e${i}`;
  }
  return nodes[0];
}

// --- #509 regression: recursive tree consumption overflowed the stack on a
// linear session (depth == entry count). The iterative rewrite must survive a
// chain far deeper than V8's call-stack limit.

test("buildActivePath finds the leaf on a 6000-deep linear chain without a stack overflow", () => {
  const root = linearTree(6000);
  const path = buildActivePath([root], "e5999");
  assert.equal(path.size, 6000);
  assert.ok(path.has("e0"));
  assert.ok(path.has("e5999"));
});

test("buildActivePath includes compressedEntryIds targets on the path", () => {
  const root = linearTree(3);
  root.children[0].children[0].compressedEntryIds = ["hidden-1"];
  const path = buildActivePath([root], "hidden-1");
  assert.ok(path.has("e0"));
  assert.ok(path.has("e1"));
  assert.ok(path.has("e2"));
});

test("buildActivePath returns empty for a missing target", () => {
  const root = linearTree(3);
  assert.equal(buildActivePath([root], "nope").size, 0);
  assert.equal(buildActivePath([root], null).size, 0);
});

test("hasBranch reports false for a linear chain (no branching) and true otherwise", () => {
  assert.equal(hasBranch([linearTree(5000)]), false);
  const root = linearTree(3);
  root.children[0].children[0].children = [
    { entry: { type: "message", id: "b1", parentId: "e2", timestamp: "t", message: { role: "user", content: "x" } }, children: [] },
    { entry: { type: "message", id: "b2", parentId: "e2", timestamp: "t", message: { role: "user", content: "y" } }, children: [] },
  ];
  assert.equal(hasBranch([root]), true);
});

test("hasBranch reports true for multiple root nodes (a branch from the first message)", () => {
  // Each root has a single child, so no node.children.length > 1 — only the
  // multiple-root shape makes this a branch.
  const r1 = { entry: { type: "message", id: "r1", parentId: null, timestamp: "t", message: { role: "user", content: "a" } }, children: [] };
  const r2 = { entry: { type: "message", id: "r2", parentId: null, timestamp: "t", message: { role: "user", content: "b" } }, children: [] };
  assert.equal(hasBranch([r1, r2]), true);
});
