import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url);
const {
  deferredProviderModels,
  findDeferredModel,
  rememberProviderModels,
  withDeferredProviderModels,
} = await jiti.import("./deferred-provider-models.ts");

// The catalog is per process, so each test starts from an empty one.
test.beforeEach(() => { globalThis.__piWebProviderModelCatalog = new Map(); });

const model = (provider, id) => ({ provider, id, name: id, api: "openai-completions", input: [] });

function runtime(available, registered = available) {
  const models = registered;
  return {
    getAvailable: async () => available,
    getModels: () => models,
    getModel: (provider, id) => models.find((m) => m.provider === provider && m.id === id),
    hasConfiguredAuth: () => true,
  };
}

test("a provider the runtime has not registered yet is remembered and added back", async () => {
  // The catalog is per process, so start from a provider no earlier test used.
  const first = runtime([model("deferred-a", "m1")]);
  await rememberProviderModels(first);

  // A later runtime registers nothing: the remembered provider shows up again.
  const second = runtime([]);
  const deferred = deferredProviderModels(second);
  assert.deepEqual(deferred.map((m) => `${m.provider}/${m.id}`), ["deferred-a/m1"]);
  assert.deepEqual(findDeferredModel(second, "deferred-a", "m1")?.id, "m1");
  assert.equal(findDeferredModel(second, "deferred-a", "other"), undefined);
});

test("a provider the runtime registered but cannot use is never added back", async () => {
  await rememberProviderModels(runtime([model("deferred-b", "m1")]));
  // Signed out: the runtime knows the provider, it just has no available model.
  const signedOut = runtime([], [model("deferred-b", "m1")]);
  assert.deepEqual(deferredProviderModels(signedOut), []);
});

test("the proxy adds the deferred models and keeps everything else bound", async () => {
  await rememberProviderModels(runtime([model("deferred-c", "m1"), model("deferred-c", "m2")]));
  const inner = runtime([model("plain", "p1")]);
  const proxied = withDeferredProviderModels(inner);

  const all = await proxied.getAvailable();
  assert.deepEqual(all.map((m) => `${m.provider}/${m.id}`).sort(), ["deferred-c/m1", "deferred-c/m2", "plain/p1"]);
  // A provider-filtered read only adds that provider's deferred models.
  const filtered = await proxied.getAvailable("plain");
  assert.deepEqual(filtered.map((m) => m.provider), ["plain"]);
  // Methods are still bound to the runtime, so `this` works.
  assert.deepEqual(proxied.getModels().map((m) => m.provider), ["plain"]);
  assert.equal(proxied.getModel("plain", "p1").id, "p1");
  assert.equal(proxied.hasConfiguredAuth(), true);
});

test("remembering a new provider drops a listing cached before it was known", async () => {
  // The route calls invalidateModelsCache() when a provider appears for the first
  // time; otherwise a cached listing would hide it for the cache lifetime.
  const { invalidateModelsCache } = await jiti.import("./models-cache.ts");
  await rememberProviderModels(runtime([model("deferred-d", "m1")]));
  assert.equal(typeof invalidateModelsCache, "function");
  // Remembering the same provider again is a no-op for the cache.
  invalidateModelsCache();
  await rememberProviderModels(runtime([model("deferred-d", "m1")]));
  assert.deepEqual(deferredProviderModels(runtime([])).map((m) => m.provider), ["deferred-d"]);
});

test("the model routes and the session start both consult the catalog", async () => {
  const { readFile } = await import("node:fs/promises");
  const route = await readFile(new URL("../app/api/models/route.ts", import.meta.url), "utf8");
  assert.match(route, /await rememberProviderModels\(services\.modelRuntime\);/);
  assert.match(route, /withDeferredProviderModels\(services\.modelRuntime\)/);

  const rpc = await readFile(new URL("./rpc-manager.ts", import.meta.url), "utf8");
  assert.match(rpc, /findDeferredModel\(services\.modelRuntime, initialModel\.provider, initialModel\.modelId\)/);
  assert.match(rpc, /findDeferredModel\(services\.modelRuntime, savedModel\.provider, savedModel\.modelId\)/);
  // A session built on the fallback switches once its extensions are bound.
  assert.match(rpc, /wrapper\.send\(\{ type: "set_model", provider: deferredModel\.provider, modelId: deferredModel\.id \}\)/);
  assert.match(rpc, /rememberProviderModels\(inner\.modelRuntime/);
});
