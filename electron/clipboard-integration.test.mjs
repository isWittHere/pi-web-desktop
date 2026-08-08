import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const main = readFileSync(new URL("./main.js", import.meta.url), "utf8");
const preload = readFileSync(new URL("./preload.js", import.meta.url), "utf8");
const clipboard = readFileSync(new URL("../lib/clipboard.ts", import.meta.url), "utf8");

test("desktop clipboard keeps native edit actions and a main-process fallback", () => {
  assert.match(main, /role: "editMenu"/);
  assert.match(main, /webContents\.on\("context-menu"/);
  assert.match(main, /ipcMain\.handle\("clipboard:write-text"/);
  assert.match(preload, /writeClipboardText/);
  assert.match(clipboard, /window\.piDesktop\?\.writeClipboardText/);
});

test("macOS tray icon uses the native menu-bar size and template rendering", () => {
  assert.match(main, /"public", "pi-original\.png"/);
  assert.match(main, /resize\(\{ width: 16, height: 16, quality: "best" \}\)/);
  assert.match(main, /setTemplateImage\(true\)/);
});
