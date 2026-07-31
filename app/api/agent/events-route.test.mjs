import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const source = await readFile(new URL("./[id]/events/route.ts", import.meta.url), "utf8");

test("agent SSE omits unconsumed events and projects only client fields", () => {
  assert.match(source, /OMITTED_EVENT_TYPES = new Set\(\["turn_start", "turn_end", "tool_execution_update"\]\)/);
  assert.match(source, /delete clientEvent\.assistantMessageEvent/);
  assert.match(source, /event\.type === "agent_end"/);
  assert.match(source, /event\.willRetry !== undefined/);
  assert.match(source, /event\.messages !== undefined/);
  assert.match(source, /const clientEvent = toClientEvent\(event\)/);
});

test("agent SSE reuses one TextEncoder per stream", () => {
  assert.equal((source.match(/new TextEncoder\(\)/g) ?? []).length, 1);
  assert.match(source, /controller\.enqueue\(encoder\.encode\(text\)\)/);
  assert.match(source, /controller\.enqueue\(encoder\.encode\(":\\n\\n"\)\)/);
});
