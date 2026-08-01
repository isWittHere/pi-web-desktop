import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

// ToolCallBlock renders plain-text tool results that can reach 45K chars.
// These tests pin the large-output optimizations at the source level:
// memoization of the block, memoized JSON serialization, and an 8K-char
// preview with a "load full output" opt-in.

const source = await readFile(new URL("./MessageView.tsx", import.meta.url), "utf8");

test("ToolCallBlock is memoized so stable props skip re-render during streaming", () => {
  assert.match(
    source,
    /export const ToolCallBlock = memo\(function ToolCallBlock/,
  );
});

test("input args JSON serialization is memoized per block", () => {
  assert.match(
    source,
    /const inputStr = useMemo\(\(\) => JSON\.stringify\(block\.input, null, 2\), \[block\.input\]\);/,
  );
});

test("result text extraction is memoized per result", () => {
  assert.match(
    source,
    /const resultText = useMemo\(\s*\(\) => \(result\s*\?[\s\S]*?\[result\],/,
  );
});

test("large results render a preview and opt into the full payload", () => {
  assert.match(source, /const RESULT_PREVIEW_CHARS = 8000;/);
  assert.match(
    source,
    /const truncated = !isEmpty && text\.length > RESULT_PREVIEW_CHARS && !showFull;/,
  );
  assert.match(
    source,
    /const displayText = truncated \? text\.slice\(0, RESULT_PREVIEW_CHARS\) : text;/,
  );
  assert.match(source, /setShowFull\(true\)/);
  // Reuses the existing i18n key instead of adding a new one.
  assert.match(source, /t\("desktop\.loadFullOutput"\)/);
});
