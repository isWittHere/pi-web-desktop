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

test("a write's file text is shown instead of its input JSON", () => {
  const source = readFileSync(new URL("./MessageView.tsx", import.meta.url), "utf8");
  assert.match(source, /getWrittenFileText\(block\) \?\? JSON\.stringify\(block\.input, null, 2\)/);
  assert.match(source, /const WRITE_VIEW_KEYS = new Set\(\["path", "file_path", "content"\]\);/);
  assert.match(source, /if \(!isWriteToolName\(block\.toolName\)\) return null;/);
  // Only a plain path + content write: another argument would vanish from the view.
  assert.match(source, /Object\.keys\(block\.input\)\.every\(\(key\) => WRITE_VIEW_KEYS\.has\(key\)\)/);
});

test("the duration a card shows comes from what pi recorded, not a timestamp difference", () => {
  const source = readFileSync(new URL("./MessageView.tsx", import.meta.url), "utf8");
  assert.match(source, /const ms = recordedDurationMs\(result\.durationMs\)/);
  assert.match(source, /ms >= TOOL_DURATION_MIN_MS/);
  assert.match(source, /\{formatToolDuration\(duration\)\}/);
});
