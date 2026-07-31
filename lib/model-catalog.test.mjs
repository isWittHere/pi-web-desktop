import assert from "node:assert/strict";
import test from "node:test";
import jitiFactory from "jiti";

const jiti = jitiFactory(import.meta.url, { interopDefault: true });
const { flattenModelsDevCatalog, recommendModelCatalogPreset } = jiti("./model-catalog.ts");

const catalog = flattenModelsDevCatalog({
  openai: {
    name: "OpenAI",
    api: "https://api.openai.com/v1",
    models: {
      "gpt-test": {
        name: "GPT Test",
        reasoning: true,
        modalities: { input: ["text", "image", "audio"] },
        limit: { context: 128000, output: 16384 },
        cost: { input: 2.5, output: 10, cache_read: 0.25, cache_write: 1.25 },
      },
    },
  },
  reseller: {
    name: "Reseller",
    api: "https://reseller.example/v1",
    models: {
      "gpt-test": { name: "Different name", cost: { input: 9, output: 19 } },
    },
  },
});

test("flattens only supported catalog fields", () => {
  assert.equal(catalog.length, 2);
  assert.deepEqual(catalog[0].input, ["text", "image"]);
  assert.equal(catalog[0].contextWindow, 128000);
  assert.equal(catalog[0].cost.cacheRead, 0.25);
  assert.equal(catalog[0].cost.cacheWrite, 1.25);
});

test("prefers a matching provider and permits its price", () => {
  const recommendation = recommendModelCatalogPreset(catalog, "models/gpt-test", "openai");
  assert.equal(recommendation.metadataMethod, "provider");
  assert.equal(recommendation.preset.name, "GPT Test");
  assert.equal(recommendation.preset.cost?.output, 10);
  assert.equal(recommendation.price.reliable, true);
});

test("matches a matching catalog base URL host", () => {
  const recommendation = recommendModelCatalogPreset(catalog, "gpt-test", "unknown", "https://api.openai.com/v1/chat");
  assert.equal(recommendation.metadataMethod, "base-url");
  assert.equal(recommendation.preset.cost?.input, 2.5);
});

test("does not infer prices without a trustworthy provider or URL match", () => {
  const recommendation = recommendModelCatalogPreset(catalog, "gpt-test", "unknown", "https://api.openai.com.example.com");
  assert.equal(recommendation.metadataMethod, "consensus");
  assert.equal(recommendation.price.reliable, false);
  assert.equal(recommendation.preset.cost, undefined);
});

test("returns no preset for a non-exact model id", () => {
  const recommendation = recommendModelCatalogPreset(catalog, "gpt");
  assert.equal(recommendation.exactMatches, 0);
  assert.deepEqual(recommendation.preset, {});
});
