import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const main = readFileSync(new URL("./main.js", import.meta.url), "utf8");

test("macOS tray icon uses native menu-bar size and template rendering", () => {
  assert.match(main, /resize\(\{ width: 16, height: 16, quality: "best" \}\)/);
  assert.match(main, /setTemplateImage\(true\)/);
});
