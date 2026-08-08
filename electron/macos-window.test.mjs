import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const main = readFileSync(new URL("./main.js", import.meta.url), "utf8");
const preload = readFileSync(new URL("./preload.js", import.meta.url), "utf8");
const titleBar = readFileSync(new URL("../components/AppTitleBar.tsx", import.meta.url), "utf8");
const packageJson = readFileSync(new URL("../package.json", import.meta.url), "utf8");

test("macOS uses native left-side traffic lights instead of custom right-side controls", () => {
  assert.match(main, /titleBarStyle: process\.platform === "darwin" \? "hidden" : undefined/);
  assert.match(main, /trafficLightPosition: process\.platform === "darwin"/);
  assert.match(preload, /platform: process\.platform/);
  assert.match(titleBar, /isElectron && !isMac/);
});

test("macOS packaging uses the Pi app icon instead of Electron's default", () => {
  assert.match(packageJson, /"icon": "public\/icon\.png"/);
});
