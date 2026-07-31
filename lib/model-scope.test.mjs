import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const { resolveVisibleModels, selectInitialModelScope } = await createJiti(import.meta.url).import("./model-scope.ts");

const models = [
  { id: "claude-opus", provider: "anthropic", name: "Claude Opus" },
  { id: "claude-sonnet", provider: "anthropic", name: "Claude Sonnet" },
  { id: "claude-sonnet", provider: "gateway", name: "Gateway Sonnet" },
];
const runtime = { getAvailable: async () => models };
const references = (scope) => scope.visible.map((model) => `${model.provider}/${model.id}`).sort();

test("uses pi resolver for provider and bare-model globs", async () => {
  const providerScope = await resolveVisibleModels(runtime, ["gateway/*"]);
  assert.deepEqual(references(providerScope), ["gateway/claude-sonnet"]);

  const modelScope = await resolveVisibleModels(runtime, ["*sonnet*"]);
  assert.deepEqual(references(modelScope), ["anthropic/claude-sonnet", "gateway/claude-sonnet"]);
});

test("retains thinking pins and falls back when every enabled pattern misses", async () => {
  const pinned = await resolveVisibleModels(runtime, ["anthropic/*:high"]);
  assert.equal(pinned.thinkingLevelPins["anthropic/claude-opus"], "high");
  assert.equal(pinned.thinkingLevelPins["anthropic/claude-sonnet"], "high");

  const missed = await resolveVisibleModels(runtime, ["missing/*"]);
  assert.deepEqual(references(missed), references({ visible: models }));
  assert.equal(missed.scopedModels.length, 0);
  assert.equal(missed.warnings.length, 1);
});

test("rejects an explicit model outside the enabled scope", async () => {
  const scope = await resolveVisibleModels(runtime, ["anthropic/*:high"]);
  assert.throws(
    () => selectInitialModelScope(scope, { requestedModel: { provider: "gateway", modelId: "claude-sonnet" } }),
    /not available in the enabled scope/,
  );
  assert.equal(
    selectInitialModelScope(scope, { defaultModel: { provider: "anthropic", modelId: "claude-opus" } }).thinkingLevel,
    "high",
  );
});
