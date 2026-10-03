import assert from "node:assert/strict";
import test from "node:test";

async function loadSubject() {
  return import("./message-display.ts");
}

function assistant(content) {
  return {
    role: "assistant",
    provider: "test",
    model: "test-model",
    content,
  };
}

test("plain non-empty text is an answer", async () => {
  const { hasAssistantAnswer } = await loadSubject();
  assert.equal(hasAssistantAnswer(assistant([{ type: "text", text: "Final answer" }])), true);
});

test("thinking alone is not an answer", async () => {
  const { hasAssistantAnswer } = await loadSubject();
  assert.equal(hasAssistantAnswer(assistant([{ type: "thinking", thinking: "work through it" }])), false);
});

test("an image block is an answer", async () => {
  const { hasAssistantAnswer } = await loadSubject();
  assert.equal(
    hasAssistantAnswer(assistant([{ type: "image", source: { type: "url", url: "https://example.com/a.png" } }])),
    true,
  );
});

test("a tool call block is an answer", async () => {
  const { hasAssistantAnswer } = await loadSubject();
  assert.equal(
    hasAssistantAnswer(assistant([{ type: "toolCall", toolCallId: "call-1", toolName: "bash", input: {} }])),
    true,
  );
});

test("empty content and whitespace-only text are not answers", async () => {
  const { hasAssistantAnswer } = await loadSubject();
  assert.equal(hasAssistantAnswer(assistant([])), false);
  assert.equal(hasAssistantAnswer(assistant([{ type: "text", text: "   " }])), false);
});
