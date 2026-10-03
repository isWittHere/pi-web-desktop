import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url);
const wire = await jiti.import("./agent-event-wire.ts");
const { isEventIncludedInSnapshot, isSystemMessageEvent, toClientAgentEvent, isNestedToolExecutionEvent, CODEMODE_SNAPSHOT_CALL_LIMIT } = wire;

test("omits events the desktop client never consumes", () => {
  for (const type of ["turn_start", "turn_end", "entry_appended"]) {
    assert.equal(toClientAgentEvent({ type }), null);
  }
});

test("detects nested tool execution events by parentToolCallId", () => {
  assert.equal(isNestedToolExecutionEvent({ type: "tool_execution_start", parentToolCallId: "call-1/2" }), true);
  assert.equal(isNestedToolExecutionEvent({ type: "tool_execution_end", parentToolCallId: "call-1" }), true);
  // A top-level call has no parentToolCallId.
  assert.equal(isNestedToolExecutionEvent({ type: "tool_execution_start", toolCallId: "call-1" }), false);
  assert.equal(isNestedToolExecutionEvent({ type: "tool_execution_start", parentToolCallId: "" }), false);
  assert.equal(isNestedToolExecutionEvent({ type: "message_update" }), false);
});

test("sends nested tool starts and ends slim and drops nested updates", () => {
  // Nested start: only identity fields survive.
  assert.deepEqual(toClientAgentEvent({
    type: "tool_execution_start",
    toolCallId: "call-1/1",
    toolName: "read",
    parentToolCallId: "call-1",
    args: { path: "/big" },
  }), {
    type: "tool_execution_start",
    toolCallId: "call-1/1",
    toolName: "read",
    parentToolCallId: "call-1",
  });
  // Nested end: slim, without the raw result.
  assert.deepEqual(toClientAgentEvent({
    type: "tool_execution_end",
    toolCallId: "call-1/1",
    toolName: "read",
    parentToolCallId: "call-1",
    result: "x".repeat(1000),
  }), {
    type: "tool_execution_end",
    toolCallId: "call-1/1",
    toolName: "read",
    isError: undefined,
    parentToolCallId: "call-1",
  });
  // Nested updates are dropped entirely.
  assert.equal(toClientAgentEvent({
    type: "tool_execution_update",
    toolCallId: "call-1/1",
    toolName: "read",
    parentToolCallId: "call-1",
    partialResult: { content: [{ type: "text", text: "progress" }] },
  }), null);
});

test("keeps top-level tool events and drops result from tool_execution_end", () => {
  // Top-level start passes through untouched.
  const start = { type: "tool_execution_start", toolCallId: "call-1", toolName: "bash", args: {} };
  assert.equal(toClientAgentEvent(start), start);
  // Top-level end loses the raw result: the browser reads only its ids and
  // renders the tool result message that follows.
  assert.deepEqual(toClientAgentEvent({
    type: "tool_execution_end",
    toolCallId: "call-1",
    toolName: "bash",
    isError: false,
    result: "1 MiB of output",
  }), {
    type: "tool_execution_end",
    toolCallId: "call-1",
    toolName: "bash",
    isError: false,
  });
  // Top-level updates keep the partialResult the client caches.
  const partialResult = { content: [{ type: "text", text: "phase 2" }] };
  assert.deepEqual(toClientAgentEvent({
    type: "tool_execution_update",
    toolCallId: "call-1",
    toolName: "bash",
    partialResult,
  }), { type: "tool_execution_update", toolCallId: "call-1", toolName: "bash", partialResult });
});

test("truncates codemode progress snapshots past the call limit", () => {
  const calls = Array.from({ length: CODEMODE_SNAPSHOT_CALL_LIMIT + 10 }, (_, i) => ({
    name: "read",
    arguments: { path: `/f${i}` },
  }));
  const projected = toClientAgentEvent({
    type: "tool_execution_update",
    toolCallId: "call-cm",
    toolName: "codemode",
    partialResult: { content: [], details: { calls } },
  });
  assert.equal(projected.partialResult.details.calls.length, CODEMODE_SNAPSHOT_CALL_LIMIT);
  assert.equal(projected.partialResult.details.omittedCalls, 10);
  // The newest calls are kept.
  assert.deepEqual(projected.partialResult.details.calls.at(-1), { name: "read", arguments: { path: "/f209" } });

  // Non-codemode tools are untouched.
  const other = toClientAgentEvent({
    type: "tool_execution_update",
    toolCallId: "call-w",
    toolName: "workflow",
    partialResult: { details: { calls: [1, 2, 3] } },
  });
  assert.deepEqual(other.partialResult.details.calls, [1, 2, 3]);
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
