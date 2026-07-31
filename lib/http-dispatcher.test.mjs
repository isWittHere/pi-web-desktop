import assert from "node:assert/strict";
import test from "node:test";

async function loadSubject() {
  return import("./http-dispatcher.ts");
}

test("parses bounded HTTP timeout values", async () => {
  const { parseHttpIdleTimeoutMs } = await loadSubject();

  assert.equal(parseHttpIdleTimeoutMs(300_000), 300_000);
  assert.equal(parseHttpIdleTimeoutMs(" 250 "), 250);
  assert.equal(parseHttpIdleTimeoutMs("disabled"), 0);
  assert.equal(parseHttpIdleTimeoutMs(""), undefined);
  assert.equal(parseHttpIdleTimeoutMs(-1), undefined);
  assert.equal(parseHttpIdleTimeoutMs("invalid"), undefined);
  assert.equal(parseHttpIdleTimeoutMs(Infinity), undefined);
});
