import assert from "node:assert/strict";
import test from "node:test";

import { parseGitRefTags } from "./git-graph-refs.ts";

test("splits a HEAD -> branch decoration into a HEAD chip and a branch chip", () => {
  const tags = parseGitRefTags(["HEAD -> feat/subscription-quota-history"]);
  assert.deepEqual(tags, [
    { kind: "head", label: "HEAD", ref: "HEAD" },
    { kind: "branch", label: "feat/subscription-quota-history", ref: "HEAD -> feat/subscription-quota-history" },
  ]);
});

test("classifies remotes, tags, local branches and detached HEAD", () => {
  const tags = parseGitRefTags(["origin/main", "tag: v1.2.0", "main", "HEAD"]);
  assert.deepEqual(tags.map((tag) => [tag.kind, tag.label]), [
    ["remote", "origin/main"],
    ["tag", "v1.2.0"],
    ["branch", "main"],
    ["head", "HEAD"],
  ]);
});

test("keeps the original decoration as the tooltip ref", () => {
  const [tag] = parseGitRefTags(["tag: v1.0"]);
  assert.equal(tag.ref, "tag: v1.0");
});

test("tolerates empty entries and a nameless tag decoration", () => {
  assert.deepEqual(parseGitRefTags([]), []);
  assert.deepEqual(parseGitRefTags(["", "   "]), []);
  assert.deepEqual(parseGitRefTags(["tag: "]), []);
});
