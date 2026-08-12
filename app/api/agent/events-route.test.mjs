import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const source = await readFile(new URL("./[id]/events/route.ts", import.meta.url), "utf8");
const streamSource = await readFile(new URL("../../../lib/agent-event-stream.ts", import.meta.url), "utf8");
const wireSource = await readFile(new URL("../../../lib/agent-event-wire.ts", import.meta.url), "utf8");

test("agent SSE starts sessions asynchronously and disables response buffering", () => {
  assert.match(source, /createAgentEventStream\(req, id, sessionPromise\)/);
  assert.match(source, /sessionPromise = startRpcSession\([\s\S]*?\.then\(\(result\) => result\.session\)/);
  assert.doesNotMatch(source, /await startRpcSession\(/);
  assert.match(source, /if \(req\.signal\.aborted\) return new Response\(null, \{ status: 204 \}\)/);
  assert.match(source, /"Cache-Control": "no-cache, no-transform"/);
  assert.match(source, /"X-Accel-Buffering": "no"/);
});

test("agent SSE wire omits unconsumed events and keeps desktop fields", () => {
  assert.match(wireSource, /OMITTED_EVENT_TYPES = new Set\(\[\s*"turn_start",\s*"turn_end",\s*"tool_execution_update",?\s*\]\)/);
  // The desktop client streams from the cumulative `message` snapshot, so the
  // Pi 0.84 delta payload is dropped rather than serialized per chunk.
  assert.match(wireSource, /assistantMessageEvent/);
  assert.match(wireSource, /event\.type === "agent_end"/);
  assert.match(wireSource, /event\.willRetry !== undefined/);
  assert.match(wireSource, /event\.messages !== undefined/);
});

test("agent SSE replays the live snapshot after the readiness handshake", () => {
  assert.match(streamSource, /type: "connected",[\s\S]*?isStreaming: session\.isStreaming/);
  assert.match(streamSource, /encode\(\{ type: "message_start", message: snapshot \}\)/);
  assert.match(streamSource, /isEventIncludedInSnapshot\(event, snapshot\)/);
  assert.match(streamSource, /bufferedEvents/);
  assert.match(streamSource, /startup_error/);
});

test("SSE routes reuse one TextEncoder per stream", () => {
  assert.equal((streamSource.match(/new TextEncoder\(\)/g) ?? []).length, 1);
  assert.match(streamSource, /controller\.enqueue\(encoder\.encode\(/);
});
