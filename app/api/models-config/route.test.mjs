import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { bumpModelsVersion, getModelsVersion } from "../../../lib/models-cache.ts";

// Locks the config-change event chain: a saved models.json must invalidate the
// /api/models cache and bump the polled version, or the UI silently keeps the
// old list until a restart.
test("models-config PUT invalidates the model cache and bumps the polled version", async () => {
  const source = await readFile(new URL("./route.ts", import.meta.url), "utf8");
  const writeIndex = source.indexOf("writeModelsConfig(body)");
  const invalidateIndex = source.indexOf("invalidateModelsCache()");
  const bumpIndex = source.indexOf("bumpModelsVersion()");

  assert.notEqual(writeIndex, -1, "PUT must persist the config");
  assert.notEqual(invalidateIndex, -1, "PUT must invalidate the /api/models cache");
  assert.notEqual(bumpIndex, -1, "PUT must bump the polled models version");
  assert.ok(writeIndex < invalidateIndex, "invalidate after write");
  assert.ok(writeIndex < bumpIndex, "bump after write");
});

test("models version is monotonic and never bumped by reads", () => {
  const before = getModelsVersion();
  assert.equal(getModelsVersion(), before);
  bumpModelsVersion();
  assert.equal(getModelsVersion(), before + 1);
  bumpModelsVersion();
  assert.equal(getModelsVersion(), before + 2);
});
