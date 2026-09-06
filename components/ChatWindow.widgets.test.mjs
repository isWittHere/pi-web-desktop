import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const source = await readFile(new URL("./ChatWindow.tsx", import.meta.url), "utf8");

test("extension widgets render ANSI escape sequences in color", () => {
  // The widget body must go through the shared ANSI renderer instead of
  // joining raw lines, so colored extension output displays as intended.
  const widgetsStart = source.indexOf("function ExtensionWidgets(");
  assert.notEqual(widgetsStart, -1, "ExtensionWidgets not found");
  const widgetsBlock = source.slice(widgetsStart, source.indexOf("function NoticeShelf", widgetsStart));
  assert.match(widgetsBlock, /renderAnsiLine\(line/);
  assert.doesNotMatch(widgetsBlock, /widget\.lines\.join\(/);
});

test("the ANSI renderer is backed by the shared parser", () => {
  assert.match(source, /function renderAnsiLine\(line: string, keyPrefix: string\)/);
  assert.match(source, /parseAnsiLine\(line\)\.map/);
});

test("the extension select dialog scrolls instead of overflowing", () => {
  const dialogStart = source.indexOf('maxHeight: "min(760px, 100%)"');
  assert.notEqual(dialogStart, -1, "select dialog height cap not found");
  const dialogBlock = source.slice(dialogStart, dialogStart + 3800);
  assert.match(dialogBlock, /flexDirection: "column"/);
  assert.match(dialogBlock, /flexShrink: 0/);
  assert.match(dialogBlock, /overflowY: "auto"/);
  assert.match(dialogBlock, /overflowWrap: "anywhere"/);
});
