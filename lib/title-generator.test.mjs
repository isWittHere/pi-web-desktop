import assert from "node:assert/strict";
import test from "node:test";

async function loadSubject(path) {
  try {
    const { createJiti } = await import("jiti");
    return createJiti(import.meta.url).import(path);
  } catch {
    return import(path);
  }
}

const { extractRecentTurns, parseGeneratedSessionTitle } = await loadSubject("./title-generator.ts");

function user(text) {
  return { role: "user", content: text };
}

function assistant(blocks) {
  return { role: "assistant", content: blocks };
}

function toolResult(toolCallId) {
  return { role: "toolResult", toolCallId, content: [{ type: "text", text: "result" }] };
}

test("extractRecentTurns keeps the last two complete rounds", () => {
  const messages = [
    user("first question"),
    assistant([{ type: "text", text: "first answer" }]),
    user("second question"),
    assistant([{ type: "text", text: "second answer" }]),
    user("third question"),
    assistant([{ type: "text", text: "third answer" }]),
  ];
  assert.deepEqual(extractRecentTurns(messages, 2), [
    { role: "user", text: "second question" },
    { role: "assistant", text: "second answer" },
    { role: "user", text: "third question" },
    { role: "assistant", text: "third answer" },
  ]);
});

test("extractRecentTurns keeps a trailing user message with no reply", () => {
  const messages = [
    user("question"),
    assistant([{ type: "text", text: "answer" }]),
    user("follow-up"),
  ];
  assert.deepEqual(extractRecentTurns(messages, 2), [
    { role: "user", text: "question" },
    { role: "assistant", text: "answer" },
    { role: "user", text: "follow-up" },
  ]);
});

test("extractRecentTurns strips toolCall/thinking blocks and skips tool results", () => {
  const messages = [
    user("question"),
    assistant([
      { type: "thinking", thinking: "thinking text" },
      { type: "toolCall", id: "call_1", name: "read", arguments: { path: "/x" } },
    ]),
    toolResult("call_1"),
    assistant([{ type: "text", text: "final answer" }]),
    user("next question"),
  ];
  assert.deepEqual(extractRecentTurns(messages, 2), [
    { role: "user", text: "question" },
    { role: "assistant", text: "final answer" },
    { role: "user", text: "next question" },
  ]);
});

test("extractRecentTurns merges multiple assistant messages in one round", () => {
  const messages = [
    user("question"),
    assistant([{ type: "text", text: "answer one" }]),
    assistant([{ type: "text", text: "answer two" }]),
  ];
  assert.deepEqual(extractRecentTurns(messages, 2), [
    { role: "user", text: "question" },
    { role: "assistant", text: "answer one\n\nanswer two" },
  ]);
});

test("extractRecentTurns drops empty text and handles string content", () => {
  const messages = [
    user(""),
    user("real question"),
    assistant([{ type: "toolCall", id: "call_1", name: "read", arguments: {} }]),
  ];
  assert.deepEqual(extractRecentTurns(messages, 2), [
    { role: "user", text: "real question" },
  ]);
});

test("extractRecentTurns returns empty for no user messages", () => {
  assert.deepEqual(extractRecentTurns([], 2), []);
  assert.deepEqual(extractRecentTurns([
    assistant([{ type: "text", text: "orphan answer" }]),
    toolResult("call_1"),
  ], 2), []);
});

test("extractRecentTurns strips a leading assistant turn at the slice boundary", () => {
  const messages = [
    user("one"),
    assistant([{ type: "text", text: "answer one" }]),
    user("two"),
    assistant([{ type: "text", text: "answer two" }]),
  ];
  assert.deepEqual(extractRecentTurns(messages, 1), [
    { role: "user", text: "two" },
    { role: "assistant", text: "answer two" },
  ]);
});

test("parseGeneratedSessionTitle strips fences, labels, and quotes", () => {
  assert.equal(parseGeneratedSessionTitle('```text\n"Fix the login bug"\n```'), "Fix the login bug");
  assert.equal(parseGeneratedSessionTitle('标题：修复登录问题'), "修复登录问题");
  assert.equal(parseGeneratedSessionTitle('Title: Debug the build failure.'), "Debug the build failure");
  assert.equal(parseGeneratedSessionTitle('"Add dark mode support"'), "Add dark mode support");
  assert.equal(parseGeneratedSessionTitle("\u201cImplement auth flow\u201d"), "Implement auth flow");
});

test("parseGeneratedSessionTitle unwraps JSON and collapses whitespace", () => {
  assert.equal(parseGeneratedSessionTitle('{"title":"Refactor the API client"}'), "Refactor the API client");
  assert.equal(parseGeneratedSessionTitle("  Multi   line   title  "), "Multi line title");
  // Multi-line replies: only the first line is kept (the title itself).
  assert.equal(parseGeneratedSessionTitle("First line\nignored second line"), "First line");
});

test("parseGeneratedSessionTitle truncates long titles", () => {
  const long = "A very long session title that should be truncated to sixty characters exactly ok fine";
  const parsed = parseGeneratedSessionTitle(long);
  assert.ok(Array.from(parsed).length <= 60, `expected <= 60 chars, got ${Array.from(parsed).length}`);
  assert.equal(parsed, Array.from(long).slice(0, 60).join("").trim());
});

test("parseGeneratedSessionTitle throws on unusable output", () => {
  assert.throws(() => parseGeneratedSessionTitle(""), /usable session title/);
  assert.throws(() => parseGeneratedSessionTitle("... --- ..."), /usable session title/);
});
