import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, { jsx: { runtime: "automatic" }, tsconfigPaths: true });
const { estimateTokens, estimateUpdatedTokens } = await jiti.import("./MessageView.tsx");

test("counts CJK chars as ~1 token each", () => {
  // 4 CJK chars ≈ 4 tokens; the old chars/4 rule would have said 1.
  assert.equal(estimateTokens("你好世界"), 4);
});

test("counts non-CJK chars at ~4 chars/token", () => {
  assert.equal(estimateTokens("abcd"), 1);
});

test("mixes CJK and latin text", () => {
  // "你好世界" (4 CJK) + "abcd" (4 latin) → 4 + 1 = 5
  assert.equal(estimateTokens("你好世界abcd"), 5);
});

test("treats text without a cached prefix as a fresh estimate", () => {
  const tokens = estimateUpdatedTokens({ text: "hello", tokens: 1.25 }, "不同的开头");
  assert.equal(tokens, estimateTokens("不同的开头"));
});

test("counts only the appended suffix on a growing stream", () => {
  const previous = { text: "你好世", tokens: estimateTokens("你好世") };
  const next = estimateUpdatedTokens(previous, "你好世界");
  assert.equal(next, estimateTokens("你好世界"));
  // The increment is just the one new CJK char, not the whole message.
  assert.equal(next - previous.tokens, 1);
});

test("fixes a surrogate pair split across stream deltas", () => {
  // "𠀀" (U+20000, CJK Unified Ideograph Extension B) is a supplementary-plane
  // CJK char stored as a surrogate pair. A previous delta that ended mid-pair
  // counted the lone high surrogate as one non-CJK char (0.25 token);
  // completing the pair should re-count it as one CJK token (1.0).
  const high = "𠀀".charCodeAt(0).toString(16).toUpperCase();
  assert.equal(high, "D840");
  const previous = { text: "𠀀".slice(0, 1), tokens: estimateTokens("𠀀".slice(0, 1)) };
  const next = estimateUpdatedTokens(previous, "𠀀");
  assert.equal(next, 1);
  assert.equal(estimateTokens("𠀀"), 1);
});

test("returns zero estimate for empty text", () => {
  assert.equal(estimateTokens(""), 0);
});
