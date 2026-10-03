import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url);
const { isMcpTool, isReadOnlySelection, readOnlyMcpBlockReason } = await jiti.import("./mcp-read-only-policy.ts");

test("a pinned selection is read-only when none of its tools can write", () => {
  assert.equal(isReadOnlySelection(["read", "grep", "find", "ls"]), true, "the Read-only preset");
  assert.equal(isReadOnlySelection(["read"]), true, "a subset of it");
  assert.equal(isReadOnlySelection(["read", "grep"]), true);
  // Anything that can change the world is not read-only.
  assert.equal(isReadOnlySelection(["read", "bash"]), false);
  assert.equal(isReadOnlySelection(["read", "edit"]), false);
  assert.equal(isReadOnlySelection(["read", "write"]), false);
  assert.equal(isReadOnlySelection(["read", "powershell"]), false);
  // No pin is not a read-only selection: pi's configured tools decide.
  assert.equal(isReadOnlySelection(undefined), false);
  assert.equal(isReadOnlySelection([]), false);
});

test("a tool is an MCP tool by its registration path or its name", () => {
  assert.equal(isMcpTool({ name: "mcp__docs__search", sourceInfo: { path: "builtin:mcp" } }), true);
  assert.equal(isMcpTool({ name: "unusual", sourceInfo: { path: "builtin:mcp" } }), true, "the built-in's own tools");
  assert.equal(isMcpTool({ name: "mcp__weird__call", sourceInfo: { path: "/ext/other-mcp.ts" } }), true, "another MCP extension's naming");
  assert.equal(isMcpTool({ name: "read", sourceInfo: { path: "core/read" } }), false);
  assert.equal(isMcpTool({ name: "read" }), false);
  assert.equal(isMcpTool({ name: "mcp__like", sourceInfo: { path: "/ext/not-mcp.ts" } }), true, "the name alone decides");
});

test("the block reason names the tool and the way out", () => {
  assert.match(readOnlyMcpBlockReason("mcp__docs__write"), /read-only tool selection/);
  assert.match(readOnlyMcpBlockReason("mcp__docs__write"), /"mcp__docs__write"/);
  assert.match(readOnlyMcpBlockReason("mcp__docs__write"), /readOnlyHint/);
});
