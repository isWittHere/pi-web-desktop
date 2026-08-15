import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, { tsconfigPaths: true });
const {
  hasModelCostDraftValue,
  modelCostToDraft,
  parseCompleteModelCost,
} = await jiti.import("./models-config-helpers.ts");

const source = await readFile(new URL("./ModelsConfig.tsx", import.meta.url), "utf8");

test("ignores malformed auth provider responses", () => {
  assert.match(
    source,
    /if \(Array\.isArray\(d\.providers\)\) setOauthProviders\(d\.providers\)/,
  );
  assert.match(
    source,
    /if \(Array\.isArray\(d\.providers\)\) setApiKeyProviders\(d\.providers\)/,
  );
});

test("model cost drafts default blank prices to zero unless all are blank", () => {
  const complete = {
    input: "1.25",
    output: "10",
    cacheRead: "0.125",
    cacheWrite: "0",
  };
  assert.deepEqual(parseCompleteModelCost(complete), {
    input: 1.25,
    output: 10,
    cacheRead: 0.125,
    cacheWrite: 0,
  });
  assert.deepEqual(parseCompleteModelCost({ ...complete, input: "", cacheWrite: "" }), {
    input: 0,
    output: 10,
    cacheRead: 0.125,
    cacheWrite: 0,
  });
  assert.deepEqual(parseCompleteModelCost({ input: "1.25", output: "", cacheRead: "", cacheWrite: "" }), {
    input: 1.25,
    output: 0,
    cacheRead: 0,
    cacheWrite: 0,
  });
  assert.equal(parseCompleteModelCost(modelCostToDraft()), undefined);
  assert.equal(parseCompleteModelCost({ ...complete, output: "not-a-price" }), undefined);
  assert.equal(parseCompleteModelCost({ ...complete, output: "-1" }), undefined);
  assert.equal(hasModelCostDraftValue(modelCostToDraft()), false);
  assert.equal(hasModelCostDraftValue({ ...complete, cacheWrite: "" }), true);
});

test("ModelDetail commits completed costs and removes only an all-blank group", async () => {
  const modelDetail = source.slice(
    source.indexOf("function ModelDetail"),
    source.indexOf("// ── OAuth detail"),
  );

  assert.match(modelDetail, /const completeCost = parseCompleteModelCost\(nextDraft\)/);
  assert.match(modelDetail, /if \(completeCost\)/);
  assert.match(modelDetail, /delete nextModel\.cost/);
  assert.match(modelDetail, /const nextDraft = \{ \.\.\.costDraftRef\.current, \[key\]: value \}/);
  assert.match(modelDetail, /costDraftRef\.current = nextDraft/);
  assert.match(modelDetail, /costTemplateRef\.current/);
  assert.match(modelDetail, /value=\{costDraft\[k\]\}/);
  assert.match(modelDetail, /onClick=\{toggleCostEditing\}/);
  assert.match(modelDetail, /aria-expanded=\{costEditing\}/);
  assert.match(modelDetail, /t\("desktop\.modelsCostNotProvided"\)/);
  assert.match(modelDetail, /hasModelCostDraftValue\(costDraft\) && !parseCompleteModelCost\(costDraft\)/);
});

test("API key removal reports authentication conflicts and always refreshes providers", async () => {
  const apiKeyDetailSource = source.slice(
    source.indexOf("function ApiKeyDetail"),
    source.indexOf("// ── Add provider picker"),
  );
  const removeSource = apiKeyDetailSource.slice(
    apiKeyDetailSource.indexOf("const handleRemove"),
    apiKeyDetailSource.indexOf("return ("),
  );

  assert.match(removeSource, /res\.status === 409\s*\? t\("desktop\.modelsAuthenticationStateChanged"\)/);
  assert.match(removeSource, /finally\s*\{\s*onRefresh\(\);\s*setRemoving\(false\);\s*\}/);
});

test("custom model config exposes headers and compat compatibility flags", async () => {
  // Provider-level headers editor, wired to the provider entry.
  const providerDetail = source.slice(
    source.indexOf("function ProviderDetail"),
    source.indexOf("// ── ThinkingLevelMap editor"),
  );
  assert.match(providerDetail, /<HeaderListEditor/);
  assert.match(providerDetail, /headers=\{provider\.headers\}/);
  assert.match(providerDetail, /set\("headers", headers\)/);

  // Model-level headers editor, wired to the model entry.
  assert.match(source, /headers=\{model\.headers\}/);
  assert.match(source, /set\("headers", headers\)/);

  // Model-level compat toggle reads the effective (provider+model) value so
  // hand-edited models.json settings are reflected, while writes stay on the
  // model entry as an explicit per-model override.
  assert.match(source, /effectiveCompat\(provider, model\)\["supportsDeveloperRole"\] !== false/);
  assert.match(source, /setCompatBool\(model, "supportsDeveloperRole", v\)/);
});
