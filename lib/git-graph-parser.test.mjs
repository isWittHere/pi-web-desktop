import assert from "node:assert/strict";
import test from "node:test";

import { formatGitLogCommand, parseGitLog } from "./git-graph-parser.ts";

const SEP = "\x1f";

test("parses unit-separator separated git log lines", () => {
  const raw = [
    ["abc123", "def456 789abc", "Alice", "1700000000", "feat: core engine", "HEAD -> main, origin/main"].join(SEP),
    ["789abc", "", "Bob", "1699990000", "chore: scaffold", ""].join(SEP),
    "",
  ].join("\n");
  const commits = parseGitLog(raw);

  assert.equal(commits.length, 2);
  assert.deepEqual(commits[0], {
    hash: "abc123",
    parents: ["def456", "789abc"],
    author: "Alice",
    timestamp: 1700000000,
    subject: "feat: core engine",
    refs: ["HEAD -> main", "origin/main"],
  });
  assert.deepEqual(commits[1], {
    hash: "789abc",
    parents: [],
    author: "Bob",
    timestamp: 1699990000,
    subject: "chore: scaffold",
    refs: [],
  });
});

test("subjects containing pipe characters survive the parse", () => {
  // The prototype's "|" delimiter broke here; \x1f must not.
  const raw = ["abc123", "", "Alice", "1700000000", "fix: a | b || c", ""].join(SEP);
  const [commit] = parseGitLog(raw);
  assert.equal(commit.subject, "fix: a | b || c");
});

test("skips malformed lines and tolerates a missing timestamp", () => {
  const raw = [
    "garbage line without separators",
    ["abc123", "def", "A", "", "subject", ""].join(SEP),
  ].join("\n");
  const commits = parseGitLog(raw);
  assert.equal(commits.length, 1);
  assert.equal(commits[0].timestamp, 0);
});

test("formatGitLogCommand requests topo order and the unit-separator format", () => {
  const args = formatGitLogCommand(400);
  assert.ok(args.includes("--topo-order"));
  assert.ok(args.some((arg) => arg.startsWith("--max-count=400")));
  assert.ok(args.at(-1).includes(SEP));
  assert.ok(!args.includes("--graph"));
});
