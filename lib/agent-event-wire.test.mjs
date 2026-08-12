import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url);
const { isEventIncludedInSnapshot, toClientAgentEvent } = await jiti.import("./agent-event-wire.ts");

test("omits events the desktop client never consumes", () => {
  for (const type of ["turn_start", "turn_end", "tool_execution_update"]) {
    assert.equal(toClientAgentEvent({ type }), null);
  }
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
