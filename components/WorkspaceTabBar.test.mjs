import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

// WorkspaceTabBar's pointer-drag reorder takes pointer capture on the tab
// container at pointerdown. Per the Pointer Events spec the follow-up click
// is retargeted to the capture element, so presses that start on the close
// button must be excluded from arming/capture — otherwise the button's
// onClick never fires and closing a tab appears dead. Asserted at source
// level (same rationale as ProcessGroup.test.mjs): the guard must sit inside
// handleTabPointerDown before any capture happens.

const source = await readFile(new URL("./WorkspaceTabBar.tsx", import.meta.url), "utf8");

test("pointerdown skips arming and capture for presses on buttons", () => {
  const handler = source.match(
    /const handleTabPointerDown = \(e: React\.PointerEvent<HTMLDivElement>, key: string\) => \{[\s\S]*?\n  \};/,
  );
  assert.ok(handler, "handleTabPointerDown must exist");
  const body = handler[0];
  const guard = body.indexOf('closest("button")');
  const capture = body.indexOf("setPointerCapture");
  assert.ok(guard !== -1, "handleTabPointerDown must ignore presses on buttons");
  assert.ok(capture !== -1, "handleTabPointerDown must take pointer capture for drags");
  assert.ok(guard < capture, "the button guard must run before pointer capture");
});

test("close button keeps stopPropagation so it never selects the tab", () => {
  assert.match(
    source,
    /onClick=\{\(e\) => \{ e\.stopPropagation\(\); onCloseTab\(tab\.key\); \}\}/,
  );
});
