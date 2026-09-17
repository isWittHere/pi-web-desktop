import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

function createStorage(initial = {}) {
  const values = new Map(Object.entries(initial));
  return {
    values,
    getItem(key) {
      return values.get(key) ?? null;
    },
    setItem(key, value) {
      values.set(key, value);
    },
  };
}

const storage = createStorage();
const storageListeners = [];
globalThis.window = {
  localStorage: storage,
  addEventListener(type, listener) {
    storageListeners.push({ type, listener });
  },
};

const jiti = createJiti(import.meta.url);
const {
  FAVORITE_MODELS_KEY,
  favoriteModelKey,
  parseFavoriteModels,
  getFavoriteModelsSnapshot,
  subscribeFavoriteModels,
  toggleFavoriteModel,
  toggleFavoriteModelKey,
} = await jiti.import("./favorite-models.ts");

test("favoriteModelKey joins provider and model id", () => {
  assert.equal(favoriteModelKey("QNAIGC", "z-ai/glm-5.3"), "QNAIGC:z-ai/glm-5.3");
});

test("parseFavoriteModels tolerates malformed values", () => {
  assert.deepEqual([...parseFavoriteModels(null)], []);
  assert.deepEqual([...parseFavoriteModels("")], []);
  assert.deepEqual([...parseFavoriteModels("not json")], []);
  assert.deepEqual([...parseFavoriteModels('{"a":1}')], []);
  assert.deepEqual([...parseFavoriteModels('["a",1,null,"b"]')], ["a", "b"]);
});

test("toggling persists to storage and notifies subscribers", () => {
  let notified = 0;
  const unsubscribe = subscribeFavoriteModels(() => { notified += 1; });

  toggleFavoriteModel("provider-a", "model-a");
  assert.equal(getFavoriteModelsSnapshot().has("provider-a:model-a"), true);
  assert.equal(notified, 1);
  assert.deepEqual(
    JSON.parse(storage.getItem(FAVORITE_MODELS_KEY)),
    ["provider-a:model-a"],
  );

  // Toggling the same key removes it again.
  toggleFavoriteModel("provider-a", "model-a");
  assert.equal(getFavoriteModelsSnapshot().has("provider-a:model-a"), false);
  assert.deepEqual(JSON.parse(storage.getItem(FAVORITE_MODELS_KEY)), []);

  unsubscribe();
  toggleFavoriteModelKey("provider-b:model-b");
  assert.equal(notified, 2, "unsubscribed listener must not be called again");
});

test("toggleFavoriteModelKey operates on the shared key format", () => {
  toggleFavoriteModelKey(favoriteModelKey("p", "m"));
  assert.equal(getFavoriteModelsSnapshot().has("p:m"), true);
  toggleFavoriteModelKey(favoriteModelKey("p", "m"));
  assert.equal(getFavoriteModelsSnapshot().has("p:m"), false);
});

test("cross-document storage events invalidate the cached snapshot", () => {
  const before = getFavoriteModelsSnapshot();
  storage.setItem(FAVORITE_MODELS_KEY, JSON.stringify(["remote:model"]));
  const storageEntry = storageListeners.find((entry) => entry.type === "storage");
  assert.ok(storageEntry, "a storage listener must be registered");
  storageEntry.listener({ key: FAVORITE_MODELS_KEY });
  const after = getFavoriteModelsSnapshot();
  assert.notEqual(after, before);
  assert.equal(after.has("remote:model"), true);
});
