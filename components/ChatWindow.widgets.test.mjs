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
