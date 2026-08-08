import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const main = readFileSync(new URL("./main.js", import.meta.url), "utf8");
const preload = readFileSync(new URL("./preload.js", import.meta.url), "utf8");

test("browser opening is limited to the local file API", () => {
  assert.match(main, /target\.origin !== URL \|\| !target\.pathname\.startsWith\("\/api\/files\/"\)/);
  assert.match(preload, /openExternal: \(url\) => ipcRenderer\.invoke\("shell:open-external", url\)/);
});
