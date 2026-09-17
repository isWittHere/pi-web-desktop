import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const chatInput = await readFile(new URL("./ChatInput.tsx", import.meta.url), "utf8");
const modelsConfig = await readFile(new URL("./ModelsConfig.tsx", import.meta.url), "utf8");
const store = await readFile(new URL("../lib/favorite-models.ts", import.meta.url), "utf8");

// The model selector and Settings → Models must share one reactive store; they
// previously each seeded independent state from localStorage, so a favorite
// toggled in one place was invisible to the other until a full reload.
test("both favorite consumers read the shared store instead of localStorage", () => {
  for (const source of [chatInput, modelsConfig]) {
    assert.match(source, /from "@\/lib\/favorite-models"/);
    assert.match(source, /useSyncExternalStore\(\s*subscribeFavoriteModels,\s*getFavoriteModelsSnapshot,\s*getFavoriteModelsServerSnapshot,?\s*\)/);
    assert.doesNotMatch(source, /pi-favorite-models/);
  }
});

test("only the shared store owns the localStorage key", () => {
  assert.match(store, /FAVORITE_MODELS_KEY = "pi-favorite-models"/);
  assert.match(store, /export function subscribeFavoriteModels/);
  assert.match(store, /export function getFavoriteModelsSnapshot/);
  assert.match(store, /export function getFavoriteModelsServerSnapshot/);
});

test("toggles notify same-document subscribers and cross-document storage events", () => {
  assert.match(store, /for \(const listener of listeners\) listener\(\);/);
  assert.match(store, /window\.addEventListener\("storage",/);
});
