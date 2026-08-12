import assert from "node:assert/strict";
import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url);
const {
  normalizeModelsConfigCosts,
  readModelsConfig,
  writeModelsConfig,
} = await jiti.import("./models-config-store.ts");
const { loadModelsWithCache } = await jiti.import("./models-cache.ts");

function createTempRoot(t) {
  const root = mkdtempSync(join(tmpdir(), "pi-web-models-store-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  return root;
}

test("normalizeModelsConfigCosts fills partial cost groups with zero and removes empty groups", () => {
  const config = {
    providers: {
      acme: {
        models: [
          { id: "empty-cost", cost: {} },
          { id: "partial-cost", cost: { input: 1, output: 2, cacheRead: 0.1 } },
          { id: "complete-cost", cost: { input: 1, output: 2, cacheRead: 0.1, cacheWrite: 1.1 } },
          { id: "no-cost" },
        ],
        modelOverrides: {
          inherited: { cost: { input: 3 } },
        },
      },
    },
  };

  const normalized = normalizeModelsConfigCosts(config);
  assert.deepEqual(normalized.providers.acme.models, [
    { id: "empty-cost" },
    { id: "partial-cost", cost: { input: 1, output: 2, cacheRead: 0.1, cacheWrite: 0 } },
    { id: "complete-cost", cost: { input: 1, output: 2, cacheRead: 0.1, cacheWrite: 1.1 } },
    { id: "no-cost" },
  ]);
  assert.deepEqual(normalized.providers.acme.modelOverrides, {
    inherited: { cost: { input: 3 } },
  });
  // The input object is not mutated (structuredClone).
  assert.deepEqual(config.providers.acme.models[0], { id: "empty-cost", cost: {} });
});

test("normalizeModelsConfigCosts rejects non-numeric and non-finite cost values", () => {
  const normalized = normalizeModelsConfigCosts({
    providers: {
      acme: {
        models: [
          { id: "nan", cost: { input: "1", output: 2, cacheRead: 0.1, cacheWrite: 0 } },
          { id: "infinity", cost: { input: 1, output: Infinity, cacheRead: 0.1, cacheWrite: 0 } },
          { id: "ok", cost: { input: 1, output: 2, cacheRead: 0.1, cacheWrite: 0 } },
        ],
      },
    },
  });
  const models = normalized.providers.acme.models;
  assert.deepEqual(models[0], { id: "nan" });
  assert.deepEqual(models[1], { id: "infinity" });
  assert.deepEqual(models[2], { id: "ok", cost: { input: 1, output: 2, cacheRead: 0.1, cacheWrite: 0 } });
});

test("sanitizeModelsConfig drops blank model rows on write", (t) => {
  const root = createTempRoot(t);
  const modelsPath = join(root, "agent", "models.json");
  const config = {
    providers: {
      acme: {
        models: [
          { id: "  " },
          { id: "" },
          { id: "real-model" },
        ],
      },
    },
  };

  writeModelsConfig(config, modelsPath);
  const saved = JSON.parse(readFileSync(modelsPath, "utf8"));
  assert.deepEqual(saved.providers.acme.models, [{ id: "real-model" }]);
});

test("readModelsConfig returns empty providers when file is missing or invalid", (t) => {
  const root = createTempRoot(t);
  const missing = join(root, "missing.json");
  assert.deepEqual(readModelsConfig(missing), { providers: {} });

  const invalid = join(root, "invalid.json");
  writeFileSync(invalid, "not json{");
  assert.deepEqual(readModelsConfig(invalid), { providers: {} });
});

test("writeModelsConfig persists atomically and invalidates the model-list cache", async (t) => {
  const root = createTempRoot(t);
  const modelsPath = join(root, "agent", "models.json");
  const config = {
    providers: {
      acme: {
        models: [{ id: "m1", cost: { input: 1 } }],
      },
    },
  };

  writeModelsConfig(config, modelsPath);
  assert.deepEqual(readModelsConfig(modelsPath), normalizeModelsConfigCosts(config));

  // No throwaway temp files left behind.
  const leftovers = readdirSync(join(root, "agent")).filter((name) => name.endsWith(".tmp"));
  assert.deepEqual(leftovers, []);

  // A write must invalidate the model-list cache so the next load re-reads
  // the file instead of serving the pre-write snapshot.
  let loads = 0;
  const loader = async () => {
    loads += 1;
    return {
      models: {},
      modelList: [{ id: "m1", name: "m1", provider: "acme" }],
      defaultModel: null,
      thinkingLevels: {},
      thinkingLevelMaps: {},
      thinkingLevelPins: {},
      imageInput: {},
    };
  };
  await loadModelsWithCache(root, loader);
  writeModelsConfig(config, modelsPath);
  await loadModelsWithCache(root, loader);
  assert.equal(loads, 2);
});
