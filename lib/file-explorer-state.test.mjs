import assert from "node:assert/strict";
import test from "node:test";

import { loadExplorerOpen, saveExplorerOpen } from "./file-explorer-state.ts";

function memoryStorage(initial) {
  const map = new Map(Object.entries(initial));
  return {
    getItem: (key) => (map.has(key) ? map.get(key) : null),
    setItem: (key, value) => { map.set(key, value); },
  };
}

test("defaults to open when storage is absent or missing the key", () => {
  assert.equal(loadExplorerOpen(null), true);
  assert.equal(loadExplorerOpen(memoryStorage({})), true);
});

test("loads the persisted collapsed state", () => {
  assert.equal(loadExplorerOpen(memoryStorage({ "pi-web:file-explorer:open": "false" })), false);
  assert.equal(loadExplorerOpen(memoryStorage({ "pi-web:file-explorer:open": "true" })), true);
});

test("persists the open state", () => {
  const storage = memoryStorage({});
  saveExplorerOpen(false, storage);
  assert.equal(storage.getItem("pi-web:file-explorer:open"), "false");
  saveExplorerOpen(true, storage);
  assert.equal(storage.getItem("pi-web:file-explorer:open"), "true");
});

test("falls back to open when storage access throws", () => {
  const throwing = {
    getItem: () => { throw new Error("blocked"); },
    setItem: () => { throw new Error("blocked"); },
  };
  assert.equal(loadExplorerOpen(throwing), true);
  saveExplorerOpen(false, throwing); // must not throw
});
