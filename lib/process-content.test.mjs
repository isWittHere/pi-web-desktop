import assert from "node:assert/strict";
import test from "node:test";

async function loadSubject() {
  return import("./process-content.ts");
}

function assistant(content, timestamp = 1000) {
  return {
    role: "assistant",
    provider: "test",
    model: "test-model",
    timestamp,
    content,
  };
}

test("converts Pi blocks without mutating the session message", async () => {
  const { messageToProcessContentBlocks } = await loadSubject();
  const message = assistant([
    { type: "thinking", thinking: "Inspect the repository" },
    { type: "toolCall", toolCallId: "call-1", toolName: "read_file", input: { path: "README.md" } },
  ]);
  const snapshot = structuredClone(message);

  const blocks = messageToProcessContentBlocks(message, {
    messageIndex: 4,
    entryId: "entry-4",
    phase: "process",
  });

  assert.deepEqual(message, snapshot);
  assert.deepEqual(blocks.map((block) => block.type), ["thinking", "toolCall"]);
  assert.equal(blocks[0].origin.sourceEntryId, "entry-4");
  assert.equal(blocks[1].origin.groupId, "call-1");
  assert.equal(blocks[1].status, "running");
});

test("pairs tool results and preserves error state and duration", async () => {
  const { messageToProcessContentBlocks } = await loadSubject();
  const result = {
    role: "toolResult",
    toolCallId: "call-1",
    toolName: "bash",
    timestamp: 6200,
    isError: true,
    content: [{ type: "text", text: "command failed" }],
  };
  const blocks = messageToProcessContentBlocks(
    assistant([{ type: "toolCall", toolCallId: "call-1", toolName: "bash", input: {} }], 1000),
    {
      messageIndex: 1,
      phase: "process",
      toolResults: new Map([["call-1", result]]),
    },
  );

  assert.equal(blocks[0].type, "toolCall");
  assert.equal(blocks[0].result, result);
  assert.equal(blocks[0].status, "error");
  assert.equal(blocks[0].duration, 5);
});

test("keeps source block indices for deferred thinking", async () => {
  const { messageToProcessContentBlocks } = await loadSubject();
  const message = assistant([
    { type: "thinking", thinking: "", deferred: true },
    { type: "text", text: "Final answer" },
  ]);

  const blocks = messageToProcessContentBlocks(message, {
    messageIndex: 2,
    entryId: "assistant-entry",
    phase: "process",
    blocks: [message.content[0]],
  });

  assert.equal(blocks[0].type, "thinking");
  assert.equal(blocks[0].deferred, true);
  assert.equal(blocks[0].origin.sourceBlockIndex, 0);
});

test("converts visible custom messages into process blocks", async () => {
  const { messageToProcessContentBlocks } = await loadSubject();
  const message = {
    role: "custom",
    customType: "status",
    display: true,
    content: "Checking dependencies",
  };

  const blocks = messageToProcessContentBlocks(message, {
    messageIndex: 3,
    entryId: "custom-entry",
    phase: "process",
  });

  assert.equal(blocks.length, 1);
  assert.equal(blocks[0].type, "custom");
  assert.equal(blocks[0].origin.phase, "process");
});
