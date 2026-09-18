import assert from "node:assert/strict";
import test from "node:test";

async function loadSubject() {
  return import("./comment-mentions.ts");
}

const COMMITS = [
  { hash: "a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0", subject: "fix: resolve lane overlap" },
  { hash: "0123456789abcdef0123456789abcdef01234567", subject: "Add comment mention filter" },
  { hash: "fedcba9876543210fedcba9876543210fedcba98", subject: "chore: bump deps" },
];

test("parseCommentQuery routes comment: queries and strips the prefix", async () => {
  const { parseCommentQuery } = await loadSubject();
  assert.equal(parseCommentQuery("comment:"), "");
  assert.equal(parseCommentQuery("comment:lane"), "lane");
  assert.equal(parseCommentQuery("comment:a1b2"), "a1b2");
  assert.equal(parseCommentQuery("comment：lane"), "lane"); // IME full-width colon
  assert.equal(parseCommentQuery("comment"), null); // no colon — prefix suggestion, not routed
  assert.equal(parseCommentQuery("src/chat"), null);
  assert.equal(parseCommentQuery(""), null);
  assert.equal(parseCommentQuery(null), null);
});

test("isCommentPrefixQuery matches empty and partial prefixes only", async () => {
  const { isCommentPrefixQuery } = await loadSubject();
  assert.equal(isCommentPrefixQuery(""), true);
  assert.equal(isCommentPrefixQuery("c"), true);
  assert.equal(isCommentPrefixQuery("COM"), true); // case-insensitive typing
  assert.equal(isCommentPrefixQuery("comment"), true);
  assert.equal(isCommentPrefixQuery("comment:"), false); // already routed
  assert.equal(isCommentPrefixQuery("comments"), false);
  assert.equal(isCommentPrefixQuery("src"), false);
  assert.equal(isCommentPrefixQuery(null), false);
});

test("filterCommentCommits matches hash and subject case-insensitively", async () => {
  const { filterCommentCommits } = await loadSubject();
  assert.equal(filterCommentCommits(COMMITS, "", 20).length, 3);
  assert.deepEqual(filterCommentCommits(COMMITS, "A1B2", 20), [COMMITS[0]]);
  assert.deepEqual(filterCommentCommits(COMMITS, "lane overlap", 20), [COMMITS[0]]);
  assert.deepEqual(filterCommentCommits(COMMITS, "mention", 20), [COMMITS[1]]);
  assert.equal(filterCommentCommits(COMMITS, "zzz", 20).length, 0);
  // Limit caps the result set, most recent (input order) first.
  assert.equal(filterCommentCommits(COMMITS, "", 2).length, 2);
});

test("buildCommentMentionText produces the @comment: token plus subject", async () => {
  const { buildCommentMentionText } = await loadSubject();
  const built = buildCommentMentionText(COMMITS[0]);
  assert.equal(built.text, "@comment:a1b2c3d4e5 (fix: resolve lane overlap) ");
  assert.equal(built.cursorOffset, built.text.length);
  // Empty/whitespace subject falls back to the short sha.
  const fallback = buildCommentMentionText({ hash: COMMITS[0].hash, subject: "  " });
  assert.equal(fallback.text, "@comment:a1b2c3d4e5 (a1b2c3d4e5) ");
});

test("buildCommentPrefixInsertion keeps the token open", async () => {
  const { buildCommentPrefixInsertion } = await loadSubject();
  const built = buildCommentPrefixInsertion();
  assert.equal(built.text, "@comment:");
  assert.equal(built.cursorOffset, built.text.length);
});

test("isCommentShaValue accepts sha-shaped values only", async () => {
  const { isCommentShaValue } = await loadSubject();
  assert.equal(isCommentShaValue("a1b2c3d"), true); // 7 chars (git default short)
  assert.equal(isCommentShaValue("A1B2C3D"), true); // case-insensitive
  assert.equal(isCommentShaValue("a1b2c3"), false); // 6 chars — too short to be unambiguous
  assert.equal(isCommentShaValue("a1b2c3d4e5"), true);
  assert.equal(isCommentShaValue("cafe"), false);
  assert.equal(isCommentShaValue("a1b2c3g"), false); // non-hex
  assert.equal(isCommentShaValue(""), false);
});

test("buildAtMenuItems routes comment: queries to commits only", async () => {
  const { buildAtMenuItems } = await loadSubject();
  const fileEntry = { path: "src/chat.tsx", isDir: false };
  const items = buildAtMenuItems({
    query: "comment:lane",
    quoted: false,
    commits: COMMITS,
    fileMatches: [fileEntry],
    limit: 20,
  });
  assert.equal(items.length, 1);
  assert.equal(items[0].kind, "commit");
  assert.equal(items[0].commit.hash, COMMITS[0].hash);
});

test("buildAtMenuItems hides commits while the list is loading", async () => {
  const { buildAtMenuItems } = await loadSubject();
  assert.deepEqual(buildAtMenuItems({
    query: "comment:", quoted: false, commits: null, fileMatches: [], limit: 20,
  }), []);
});

test("buildAtMenuItems offers the prefix suggestion above files", async () => {
  const { buildAtMenuItems } = await loadSubject();
  const fileEntry = { path: "components/comment.tsx", isDir: false };
  // Empty query: suggestion first, then files.
  const empty = buildAtMenuItems({ query: "", quoted: false, commits: null, fileMatches: [fileEntry], limit: 20 });
  assert.deepEqual(empty.map((i) => i.kind), ["prefix", "file"]);
  // Partial "com" typing keeps both the suggestion and matching files.
  const partial = buildAtMenuItems({ query: "com", quoted: false, commits: null, fileMatches: [fileEntry], limit: 20 });
  assert.deepEqual(partial.map((i) => i.kind), ["prefix", "file"]);
  // Unrelated queries: files only.
  const other = buildAtMenuItems({ query: "zzz", quoted: false, commits: null, fileMatches: [fileEntry], limit: 20 });
  assert.deepEqual(other.map((i) => i.kind), ["file"]);
});

test("buildAtMenuItems keeps quoted tokens file-only", async () => {
  const { buildAtMenuItems } = await loadSubject();
  const fileEntry = { path: "my dir/file.ts", isDir: false };
  // Even a routed-looking query stays file-only inside a quoted token.
  const items = buildAtMenuItems({ query: "comment:lane", quoted: true, commits: COMMITS, fileMatches: [fileEntry], limit: 20 });
  assert.deepEqual(items.map((i) => i.kind), ["file"]);
  // And a quoted empty query never shows the prefix suggestion.
  const empty = buildAtMenuItems({ query: "", quoted: true, commits: COMMITS, fileMatches: [fileEntry], limit: 20 });
  assert.deepEqual(empty.map((i) => i.kind), ["file"]);
});

test("buildAtMenuItems shows every fetched commit regardless of the file limit", async () => {
  const { buildAtMenuItems, COMMENT_FETCH_LIMIT } = await loadSubject();
  const many = Array.from({ length: 60 }, (_, i) => ({
    hash: String(i).padStart(40, "1"),
    subject: `commit ${i}`,
  }));
  // The file-result limit (20) must not clip the commit list; the fetch-size
  // cap is the only ceiling.
  const items = buildAtMenuItems({ query: "comment:", quoted: false, commits: many, fileMatches: [], limit: 20 });
  assert.equal(items.length, COMMENT_FETCH_LIMIT);
  assert.equal(items[0].commit.subject, "commit 0"); // most recent first
});

