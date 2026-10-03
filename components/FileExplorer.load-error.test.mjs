import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const source = await readFile(new URL("./FileExplorer.tsx", import.meta.url), "utf8");

test("a linked folder that cannot be opened shows a notice with retry", () => {
  const nodeStart = source.indexOf("function TreeNode(");
  const nodeEnd = source.indexOf("export const FileExplorer", nodeStart);
  const nodeBlock = source.slice(nodeStart, nodeEnd);

  // The load failure surfaces under the folder instead of being ignored.
  assert.match(nodeBlock, /const \[loadError, setLoadError\]/);
  assert.match(nodeBlock, /const \[loadFailed, setLoadFailed\]/);
  assert.match(nodeBlock, /setLoadError\(error instanceof Error \? error\.message : String\(error\)\)/);
  assert.match(nodeBlock, /role="alert"/);
  assert.match(nodeBlock, /t\("desktop\.fileLoadFailed"\)/);
  // The click offers a bounded retry of the same folder.
  assert.match(nodeBlock, /void loadChildren\(true\)/);
  // The empty placeholder is suppressed while the load failed.
  assert.match(nodeBlock, /loaded && !loadFailed/);
});
