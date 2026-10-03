import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url);
const streamModule = await jiti.import("./agent-event-stream.ts");
const { createAgentEventStream, isDroppableEvent } = streamModule;
const decoder = new TextDecoder();

const HIGH_WATER_MARK_BYTES = 512 * 1024;

async function readWithin(reader, timeoutMs = 2_000) {
  let timeout;
  try {
    return await Promise.race([
      reader.read(),
      new Promise((_, reject) => {
        timeout = setTimeout(() => reject(new Error("Timed out reading SSE chunk")), timeoutMs);
      }),
    ]);
  } finally {
    clearTimeout(timeout);
  }
}

function decodeData(chunk) {
  const text = decoder.decode(chunk.value);
  assert.match(text, /^data: /);
  return JSON.parse(text.slice("data: ".length));
}

/** Read the header-flush comment (`":\n\n"`) that forces the response headers through. */
async function skipFlushComment(reader) {
  const chunk = await readWithin(reader);
  assert.equal(decoder.decode(chunk.value), ":\n\n");
}

function deltaUpdate(sequence) {
  // A streaming delta the client can rebuild from the message_end snapshot.
  return {
    type: "message_update",
    message: { role: "assistant", content: [{ type: "text", text: `chunk ${sequence}` }] },
    assistantMessageEvent: { type: "text_delta", delta: `chunk ${sequence}` },
  };
}

function startSession() {
  let listener = null;
  return {
    isStreaming: true,
    streamingMessage: undefined,
    onEvent(nextListener) {
      listener = nextListener;
      return () => { listener = null; };
    },
    emit(event) { listener?.(event); },
  };
}

test("isDroppableEvent flags only events a later event repairs", () => {
  assert.equal(isDroppableEvent(deltaUpdate(1)), true);
  assert.equal(isDroppableEvent({ type: "tool_execution_update", toolCallId: "c" }), true);
  // *_start / *_end create and finalize blocks; never dropped.
  assert.equal(isDroppableEvent({ type: "message_update", message: { role: "assistant" } }), false);
  assert.equal(isDroppableEvent({ type: "agent_end" }), false);
  assert.equal(isDroppableEvent({ type: "message_start", message: {} }), false);
});

test("drops rebuildable deltas past the high-water mark and keeps repair events", async (t) => {
  const session = startSession();
  const stream = createAgentEventStream(
    new Request("http://localhost/events"),
    "backlog-session",
    Promise.resolve(session),
  );
  const reader = stream.getReader();
  t.after(() => reader.cancel().catch(() => {}));
  await skipFlushComment(reader);

  assert.equal((decodeData(await readWithin(reader))).type, "connected");

  // A large non-droppable chunk pushes the queue past the high-water mark…
  session.emit({
    type: "message_start",
    message: { role: "assistant", content: [{ type: "text", text: "x".repeat(HIGH_WATER_MARK_BYTES + 64 * 1024) }] },
  });
  // …then a burst of droppable deltas behind the unread big chunk: dropped.
  for (let i = 0; i < 50; i += 1) session.emit(deltaUpdate(i));
  session.emit({ type: "message_end", message: { role: "assistant", content: [{ type: "text", text: "final" }] } });

  // The client reads exactly the three chunks the burst produced: the deltas
  // never made it to the wire, while the repair events (start/end) did.
  const big = decodeData(await readWithin(reader));
  assert.equal(big.type, "message_start");
  const final = decodeData(await readWithin(reader));
  assert.equal(final.type, "message_end");
  assert.equal(final.message.content[0].text, "final");

  // Once the queue is drained below the mark, events flow normally again.
  session.emit({ type: "agent_end" });
  assert.deepEqual(decodeData(await readWithin(reader)), { type: "agent_end" });
});

test("closes the stream and releases the lease past the backlog limit", async (t) => {
  // The default limit is 16 MB; lower it so the test can exceed it quickly.
  // resolveBacklogLimitBytes reads the env at stream creation, so restore it
  // afterwards to keep the override from leaking into other tests.
  process.env.PI_WEB_SSE_BACKLOG_LIMIT_BYTES = String(2 * 1024 * 1024);
  t.after(() => { delete process.env.PI_WEB_SSE_BACKLOG_LIMIT_BYTES; });
  const session = startSession();
  const stream = createAgentEventStream(
    new Request("http://localhost/events"),
    "overload-session",
    Promise.resolve(session),
  );
  const reader = stream.getReader();
  t.after(() => reader.cancel().catch(() => {}));
  await skipFlushComment(reader);

  assert.equal((decodeData(await readWithin(reader))).type, "connected");

  // Non-droppable chunks larger than the lowered limit. The emitter may throw
  // out of the SDK listener once the stream is terminated — tolerate both.
  const bigChunk = "y".repeat(1024 * 1024);
  try {
    for (let i = 0; i < 3; i += 1) {
      session.emit({
        type: "message_start",
        message: { role: "assistant", content: [{ type: "text", text: bigChunk }] },
      });
    }
  } catch { /* stream already terminated */ }

  // The stream is hard-terminated: the pending read rejects with the backlog
  // error, so the client reconnects and re-snapshots instead of holding memory.
  await assert.rejects(
    readWithin(reader, 5_000),
    (error) => error instanceof Error && /backlog/.test(error.message),
  );
  await reader.read().catch(() => {});
});

test("normal traffic is unaffected by the backlog checks", async (t) => {
  const session = startSession();
  const stream = createAgentEventStream(
    new Request("http://localhost/events"),
    "normal-session",
    Promise.resolve(session),
  );
  const reader = stream.getReader();
  t.after(() => reader.cancel().catch(() => {}));
  await skipFlushComment(reader);

  assert.equal((decodeData(await readWithin(reader))).type, "connected");
  session.emit({ type: "agent_start" });
  session.emit(deltaUpdate(1));
  session.emit({ type: "message_end", message: { role: "assistant", content: [] } });
  session.emit({ type: "agent_end" });

  assert.deepEqual(decodeData(await readWithin(reader)), { type: "agent_start" });
  assert.equal((decodeData(await readWithin(reader))).type, "message_update");
  assert.equal((decodeData(await readWithin(reader))).type, "message_end");
  assert.deepEqual(decodeData(await readWithin(reader)), { type: "agent_end" });
});
