import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, { jsx: { runtime: "automatic" }, tsconfigPaths: true });
const { formatToolDuration } = await jiti.import("./MessageView.tsx");

test("a tool's time reads like the pi CLI's \"Took\"", () => {
  assert.equal(formatToolDuration(2400), "2.4s");
  assert.equal(formatToolDuration(100), "0.1s");
  assert.equal(formatToolDuration(0), "0.0s");
  assert.equal(formatToolDuration(59_999), "60.0s");
  assert.equal(formatToolDuration(60_000), "1m 0s");
  assert.equal(formatToolDuration(185_000), "3m 5s");
  assert.equal(formatToolDuration(3_725_000), "1h 2m 5s");
});

test("the duration a card shows comes from what pi recorded, not a timestamp difference", () => {
  // pi 1.1 records durationMs on each tool result with a monotonic clock; an older
  // result only has timestamps, and the result's minus the message's counts the
  // model's generation too. Below 100ms a card shows no time at all.
  const source = readFileSync(new URL("./MessageView.tsx", import.meta.url), "utf8");
  assert.match(source, /const ms = recordedDurationMs\(result\.durationMs\)/);
  assert.match(source, /ms >= TOOL_DURATION_MIN_MS/);
  assert.match(source, /\{formatToolDuration\(duration\)\}/);
});
