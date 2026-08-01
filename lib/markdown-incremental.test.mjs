import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, { tsconfigPaths: true });
const { splitStableParts } = await jiti.import("./markdown-incremental.ts");

test("splits multiple paragraphs into stable parts plus a growing tail", () => {
  const parts = splitStableParts("para one\n\npara two\n\npara thr");
  assert.equal(parts.length, 3);
  assert.deepEqual(
    parts.map((p) => p.text),
    ["para one", "para two", "para thr"],
  );
  assert.deepEqual(
    parts.map((p) => p.tail),
    [false, false, true],
  );
});

test("single paragraph without blank lines is entirely tail", () => {
  const parts = splitStableParts("one long line still growing");
  assert.equal(parts.length, 1);
  assert.equal(parts[0].tail, true);
  assert.equal(parts[0].text, "one long line still growing");
});

test("unterminated fence pulls everything from its opening line into the tail", () => {
  const parts = splitStableParts("before\n\n```ts\nconst x = 1;\nconst y =");
  assert.deepEqual(
    parts.map((p) => p.text),
    ["before", "```ts\nconst x = 1;\nconst y ="],
  );
  assert.deepEqual(
    parts.map((p) => p.tail),
    [false, true],
  );
});

test("closed fence becomes a stable part and later text forms the tail", () => {
  const parts = splitStableParts("before\n\n```ts\nconst x = 1;\n```\n\nafter\nstill w");
  assert.deepEqual(
    parts.map((p) => p.text),
    ["before", "```ts\nconst x = 1;\n```", "after\nstill w"],
  );
  assert.deepEqual(
    parts.map((p) => p.tail),
    [false, false, true],
  );
});

test("continuous list lines are never split mid-block", () => {
  const parts = splitStableParts("intro\n\n- a\n- b\n- c\n- d");
  assert.deepEqual(
    parts.map((p) => p.text),
    ["intro", "- a\n- b\n- c\n- d"],
  );
  assert.equal(parts[1].tail, true);
});

test("list separated by blank line splits at the blank line", () => {
  const parts = splitStableParts("- a\n- b\n\n- c\n- d");
  assert.deepEqual(
    parts.map((p) => p.text),
    ["- a\n- b", "- c\n- d"],
  );
});

test("blockquote continuation stays inside one part", () => {
  const parts = splitStableParts("> one\n> two\n> three");
  assert.equal(parts.length, 1);
  assert.equal(parts[0].tail, true);
  assert.equal(parts[0].text, "> one\n> two\n> three");
});

test("gfm table lines stay inside one part", () => {
  const parts = splitStableParts("| a | b |\n|---|---|\n| 1 | 2 |\n| 3 | 4 |");
  assert.equal(parts.length, 1);
  assert.equal(parts[0].tail, true);
});

test("consecutive blank lines collapse when forming parts", () => {
  const parts = splitStableParts("first\n\n\n\nsecond\n\ntail");
  assert.deepEqual(
    parts.map((p) => p.text),
    ["first", "second", "tail"],
  );
});

test("text ending exactly at a block boundary has no growing tail", () => {
  const parts = splitStableParts("one\n\ntwo\n\n");
  assert.deepEqual(
    parts.map((p) => p.text),
    ["one", "two"],
  );
  // No tail: the trailing blank line means the last block is complete and
  // later input starts a new block instead of mutating it.
  assert.ok(parts.every((p) => p.tail === false));
});

test("cache returns the identical string object for unchanged parts", () => {
  const cache = new Map();
  const first = splitStableParts("stable one\n\nstable two\n\ngrow", cache);
  const second = splitStableParts("stable one\n\nstable two\n\ngrow more", cache);
  assert.equal(second[0].text, first[0].text); // content equal
  assert.equal(second[0].text, "stable one");
  // Stable parts must reuse the exact interned object so memo reference
  // equality works; only the tail changes.
  const interned = cache.get(hashOf("stable one"));
  assert.equal(second[0].text, interned);
});

function hashOf(text) {
  let h1 = 0xdeadbeef;
  let h2 = 0x41c6ce57;
  for (let i = 0; i < text.length; i++) {
    const ch = text.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(36);
}

test("fence state machine matches normalizeDisplayMath for mixed fences", () => {
  // ~~~ opens, ``` inside is content, ~~~ closes, then a new ``` is open.
  const parts = splitStableParts("text\n\n~~~\n```\nnot a fence\n~~~\n\ntrailing ```");
  assert.deepEqual(
    parts.map((p) => p.text),
    ["text", "~~~\n```\nnot a fence\n~~~", "trailing ```"],
  );
});
