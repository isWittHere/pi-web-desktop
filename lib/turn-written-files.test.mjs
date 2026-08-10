import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, { tsconfigPaths: true });
const { countPatchStats, extractTurnWrittenFiles } = await jiti.import("./turn-written-files.ts");

function toolCall(toolCallId, toolName, input) {
  return { type: "toolCall", toolCallId, toolName, input };
}

function okResult(toolCallId) {
  return { role: "toolResult", toolCallId, content: [{ type: "text", text: "ok" }] };
}

function errorResult(toolCallId) {
  return { role: "toolResult", toolCallId, content: [{ type: "text", text: "boom" }], isError: true };
}

function results(...entries) {
  return new Map(entries.map((r) => [r.toolCallId, r]));
}

function paths(content, toolResults, cwd) {
  return extractTurnWrittenFiles(content, toolResults, cwd).map((f) => f.filePath);
}

test("extracts a file from a successful write tool call", () => {
  const content = [toolCall("1", "write", { file_path: "/abs/out/report.html" })];
  assert.deepEqual(paths(content, results(okResult("1"))), ["/abs/out/report.html"]);
});

test("extracts a file from a successful edit tool call using input.path", () => {
  const content = [toolCall("1", "edit", { path: "/abs/src/a.ts" })];
  assert.deepEqual(paths(content, results(okResult("1"))), ["/abs/src/a.ts"]);
});

test("accepts namespaced write/edit tool names from MCP servers", () => {
  const content = [
    toolCall("1", "write_file", { file_path: "/abs/a.txt" }),
    toolCall("2", "fs.edit", { file_path: "/abs/b.txt" }),
    toolCall("3", "str_replace_editor", { file_path: "/abs/c.txt" }),
  ];
  assert.deepEqual(
    paths(content, results(okResult("1"), okResult("2"), okResult("3"))),
    ["/abs/a.txt", "/abs/b.txt", "/abs/c.txt"],
  );
});

test("skips a tool call whose result errored", () => {
  const content = [toolCall("1", "write", { file_path: "/abs/out/report.html" })];
  assert.deepEqual(paths(content, results(errorResult("1"))), []);
});

test("skips a tool call whose result has not arrived (streaming)", () => {
  const content = [toolCall("1", "write", { file_path: "/abs/out/report.html" })];
  assert.deepEqual(paths(content, results()), []);
  assert.deepEqual(paths(content, undefined), []);
});

test("deduplicates the same file written then edited", () => {
  const content = [
    toolCall("1", "write", { file_path: "/abs/out/report.html" }),
    toolCall("2", "edit", { path: "/abs/out/report.html" }),
  ];
  assert.deepEqual(paths(content, results(okResult("1"), okResult("2"))), ["/abs/out/report.html"]);
});

test("resolves a relative path against cwd", () => {
  const content = [toolCall("1", "write", { file_path: "out/report.html" })];
  assert.deepEqual(paths(content, results(okResult("1")), "/abs"), ["/abs/out/report.html"]);
});

test("resolves extensionless and dot-prefixed filenames against cwd", () => {
  const content = [
    toolCall("1", "write", { path: "LICENSE" }),
    toolCall("2", "write", { path: ".env" }),
  ];
  assert.deepEqual(
    paths(content, results(okResult("1"), okResult("2")), "/repo"),
    ["/repo/LICENSE", "/repo/.env"],
  );
});

test("preserves path characters that have special meaning in hrefs", () => {
  const content = [
    toolCall("1", "write", { path: "release#1.md" }),
    toolCall("2", "write", { path: "query?.json" }),
    toolCall("3", "write", { path: "report.md:42" }),
  ];
  assert.deepEqual(
    paths(content, results(okResult("1"), okResult("2"), okResult("3")), "/repo"),
    ["/repo/release#1.md", "/repo/query?.json", "/repo/report.md:42"],
  );
});

test("normalizes Windows-relative tool paths against a Windows cwd", () => {
  const content = [toolCall("1", "write", { path: "src\\report.html" })];
  assert.deepEqual(
    paths(content, results(okResult("1")), "C:\\repo"),
    ["C:/repo/src/report.html"],
  );
});

test("skips non-writing tools like read and bash", () => {
  const content = [
    toolCall("1", "read", { file_path: "/abs/a.ts" }),
    toolCall("2", "bash", { command: "echo hi > /abs/a.txt" }),
  ];
  assert.deepEqual(paths(content, results(okResult("1"), okResult("2"))), []);
});

test("ignores paths that only appear in the reply text", () => {
  // A path the assistant merely writes in prose is not evidence of a write.
  const content = [
    { type: "text", text: "I saved the report to /abs/out/report.html for you." },
  ];
  assert.deepEqual(paths(content, results()), []);
});

test("lists only the file actually written, not others named in the text", () => {
  const content = [
    toolCall("1", "write", { file_path: "/abs/out/real.html" }),
    { type: "text", text: "See also /abs/out/imagined.html and /etc/passwd" },
  ];
  assert.deepEqual(paths(content, results(okResult("1"))), ["/abs/out/real.html"]);
});

test("skips a write call missing both file_path and path", () => {
  const content = [toolCall("1", "write", { content: "hi" })];
  assert.deepEqual(paths(content, results(okResult("1"))), []);
});

test("returns an empty array for an empty or text-only turn", () => {
  assert.deepEqual(paths([], results()), []);
  assert.deepEqual(paths([{ type: "text", text: "hi" }], results()), []);
});

test("counts added and removed lines in a patch", () => {
  const patch = [
    "--- a/src/a.ts",
    "+++ b/src/a.ts",
    "@@ -1,6 +1,7 @@",
    " line1",
    " keep me",
    "-old line",
    "+new line A",
    "+new line B",
    " keep me too",
    " line5",
    " line6",
  ].join("\n");
  assert.deepEqual(countPatchStats(patch), { additions: 2, deletions: 1 });
});

test("accumulates stats across multiple hunks", () => {
  const patch = [
    "--- a/x",
    "+++ b/x",
    "@@ -1,3 +1,3 @@",
    " a",
    "-b",
    "+B",
    " c",
    "@@ -10,2 +10,2 @@",
    " j",
    "-k",
    "+K",
  ].join("\n");
  assert.deepEqual(countPatchStats(patch), { additions: 2, deletions: 2 });
});

test("ignores hunk headers and no-newline markers", () => {
  const patch = [
    "--- a/x.txt",
    "+++ b/x.txt",
    "@@ -1 +1 @@",
    "-old",
    "+new",
    "\\ No newline at end of file",
  ].join("\n");
  assert.deepEqual(countPatchStats(patch), { additions: 1, deletions: 1 });
});

test("counts empty added/removed lines and content starting with ++", () => {
  const patch = [
    "--- a/empty.md",
    "+++ b/empty.md",
    "@@ -0,0 +1,3 @@",
    "+",
    "+++not-a-header",
    "+---also-not",
  ].join("\n");
  // The bare + is an empty added line; +++++ lines are added lines whose
  // content starts with +/--. Only the +++ file header is skipped.
  assert.deepEqual(countPatchStats(patch), { additions: 3, deletions: 0 });
});

function editResult(toolCallId, patch) {
  return {
    role: "toolResult",
    toolCallId,
    content: [{ type: "text", text: "ok" }],
    details: { patch, firstChangedLine: 1 },
  };
}

test("attaches diff stats from an edit tool's details.patch", () => {
  const patch = "--- a/f.ts\n+++ b/f.ts\n@@ -1 +1 @@\n-old\n+new\n";
  const content = [toolCall("1", "edit", { path: "/abs/f.ts" })];
  const [file] = extractTurnWrittenFiles(content, results(editResult("1", patch)));
  assert.equal(file.additions, 1);
  assert.equal(file.deletions, 1);
});

test("accumulates stats across multiple edits to the same file", () => {
  const content = [
    toolCall("1", "edit", { path: "/abs/f.ts" }),
    toolCall("2", "edit", { path: "/abs/f.ts" }),
  ];
  const [file] = extractTurnWrittenFiles(content, results(
    editResult("1", "--- a/f.ts\n+++ b/f.ts\n@@ -1 +1 @@\n-x\n+y\n"),
    editResult("2", "--- a/f.ts\n+++ b/f.ts\n@@ -1 +1 @@\n-y\n+z\n"),
  ));
  assert.equal(file.additions, 2);
  assert.equal(file.deletions, 2);
});

test("counts write tool content lines as additions", () => {
  const content = [toolCall("1", "write", { path: "/abs/f.ts", content: "a\nb\nc\n" })];
  const [file] = extractTurnWrittenFiles(content, results(okResult("1")));
  assert.equal(file.additions, 3);
  assert.equal(file.deletions, undefined);
});

test("omits stats when the edit result has no details", () => {
  const content = [toolCall("1", "edit", { path: "/abs/f.ts" })];
  const [file] = extractTurnWrittenFiles(content, results(okResult("1")));
  assert.deepEqual(file, { filePath: "/abs/f.ts" });
});

test("counts stats for namespaced MCP write and edit names", () => {
  const content = [
    toolCall("1", "write_file", { path: "/abs/w.txt", content: "one\ntwo\n" }),
    toolCall("2", "fs.edit", { path: "/abs/w.txt" }),
  ];
  const [file] = extractTurnWrittenFiles(content, results(
    okResult("1"),
    editResult("2", "--- a/w.txt\n+++ b/w.txt\n@@ -1 +1 @@\n-x\n+y\n"),
  ));
  assert.equal(file.additions, 3);
  assert.equal(file.deletions, 1);
});
