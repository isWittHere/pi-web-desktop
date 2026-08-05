import assert from "node:assert/strict";
import test from "node:test";
import { toCwdRelativeMentions } from "./file-mentions.ts";

test("converts absolute paths under cwd to relative mentions", () => {
  const { mentions, rejected } = toCwdRelativeMentions(
    ["/repo/src/app.ts", "/repo/package.json"],
    "/repo",
  );
  assert.deepEqual(mentions, ["src/app.ts", "package.json"]);
  assert.deepEqual(rejected, []);
});

test("normalizes backslashes (Windows paths)", () => {
  const { mentions, rejected } = toCwdRelativeMentions(
    ["C:\\repo\\src\\app.ts", "C:/repo/README.md"],
    "C:\\repo",
  );
  assert.deepEqual(mentions, ["src/app.ts", "README.md"]);
  assert.deepEqual(rejected, []);
});

test("matches Windows drive paths case-insensitively", () => {
  const { mentions, rejected } = toCwdRelativeMentions(
    ["c:/REPO/src/app.ts"],
    "C:\\Repo",
  );
  assert.deepEqual(mentions, ["src/app.ts"]);
  assert.deepEqual(rejected, []);
});

test("rejects paths outside cwd", () => {
  const { mentions, rejected } = toCwdRelativeMentions(
    ["/repo/src/app.ts", "/other/file.ts", "/repo-adjacent/x.ts"],
    "/repo",
  );
  assert.deepEqual(mentions, ["src/app.ts"]);
  assert.deepEqual(rejected, ["/other/file.ts", "/repo-adjacent/x.ts"]);
});

test("rejects the cwd itself and paths that collapse to it", () => {
  const { mentions, rejected } = toCwdRelativeMentions(["/repo", "/repo/"], "/repo");
  assert.deepEqual(mentions, []);
  assert.deepEqual(rejected, ["/repo", "/repo/"]);
});

test("rejects a sibling with a shared string prefix", () => {
  const { mentions, rejected } = toCwdRelativeMentions(
    ["/home/user/projects/foo-bar/a.ts"],
    "/home/user/projects/foo",
  );
  assert.deepEqual(mentions, []);
  assert.deepEqual(rejected, ["/home/user/projects/foo-bar/a.ts"]);
});

test("handles empty inputs", () => {
  const { mentions, rejected } = toCwdRelativeMentions([], "/repo");
  assert.deepEqual(mentions, []);
  assert.deepEqual(rejected, []);
  const empty = toCwdRelativeMentions(["/repo/a.ts"], "");
  assert.deepEqual(empty.mentions, []);
  assert.deepEqual(empty.rejected, ["/repo/a.ts"]);
});
