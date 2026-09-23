import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url);
const { isEventIncludedInSnapshot, isSystemMessageEvent, toClientAgentEvent } = await jiti.import("./agent-event-wire.ts");

test("omits events the desktop client never consumes", () => {
  for (const type of ["turn_start", "turn_end"]) {
    assert.equal(toClientAgentEvent({ type }), null);
  }
});

test("forwards tool execution progress without repeating tool arguments", () => {
  const partialResult = {
    content: [{ type: "text", text: "Running phase 2" }],
    details: { phase: 2 },
  };

  assert.deepEqual(toClientAgentEvent({
    type: "tool_execution_update",
    toolCallId: "call-workflow-1",
    toolName: "workflow",
    args: { large: "repeated input" },
    partialResult,
  }), {
    type: "tool_execution_update",
    toolCallId: "call-workflow-1",
    toolName: "workflow",
    partialResult,
  });
});

test("keeps the cumulative message snapshot on message_update and drops the delta", () => {
  const message = { role: "assistant", content: [{ type: "text", text: "hi" }] };
  assert.deepEqual(toClientAgentEvent({
    type: "message_update",
    message,
    assistantMessageEvent: { type: "text_delta", delta: "hi", partial: message },
  }), {
    type: "message_update",
    message,
  });
});

test("preserves the desktop-only agent_end failure payload", () => {
  const messages = [{ role: "assistant", stopReason: "error", errorMessage: "boom" }];
  assert.deepEqual(toClientAgentEvent({ type: "agent_end", willRetry: false, messages }), {
    type: "agent_end",
    willRetry: false,
    messages,
  });
  assert.deepEqual(toClientAgentEvent({ type: "agent_end" }), { type: "agent_end" });
});

test("passes other events through untouched", () => {
  const event = { type: "agent_start", extra: 1 };
  assert.equal(toClientAgentEvent(event), event);
});

test("snapshot inclusion checks streaming updates against the replayed snapshot", () => {
  const snapshot = { role: "assistant", content: [] };
  assert.equal(isEventIncludedInSnapshot({ type: "message_start", message: snapshot }, snapshot), true);
  assert.equal(isEventIncludedInSnapshot({ type: "message_update", message: snapshot }, snapshot), true);
  assert.equal(isEventIncludedInSnapshot({ type: "agent_start" }, snapshot), false);
  assert.equal(isEventIncludedInSnapshot({ type: "message_update", message: { ...snapshot } }, snapshot), false);
  assert.equal(isEventIncludedInSnapshot({ type: "message_update", message: snapshot }, undefined), false);
});

test("drops transcript system messages before they reach the browser", () => {
  // Pi >= 0.86 announces the persisted prompt and tool loadout as a system
  // message; it is never rendered and carries every tool schema.
  const systemMessage = {
    role: "system",
    content: "",
    sections: { preamble: "You are an expert coding assistant." },
    toolsAdded: [{ name: "read" }],
  };
  assert.equal(isSystemMessageEvent({ type: "message_start", message: systemMessage }), true);
  assert.equal(isSystemMessageEvent({ type: "message_end", message: systemMessage }), true);
  assert.equal(toClientAgentEvent({ type: "message_start", message: systemMessage }), null);
  assert.equal(toClientAgentEvent({ type: "message_end", message: systemMessage }), null);
  // Ordinary conversation messages still pass through.
  assert.equal(isSystemMessageEvent({ type: "message_start", message: { role: "assistant", content: [] } }), false);
  assert.notEqual(toClientAgentEvent({ type: "message_start", message: { role: "assistant", content: [] } }), null);
});
