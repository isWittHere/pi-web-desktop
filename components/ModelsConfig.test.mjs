import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("API key removal reports authentication conflicts and always refreshes providers", async () => {
  const source = await readFile(new URL("./ModelsConfig.tsx", import.meta.url), "utf8");
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
  const source = await readFile(new URL("./ModelsConfig.tsx", import.meta.url), "utf8");

  // Provider-level headers editor, wired to the provider entry.
  const providerDetail = source.slice(
    source.indexOf("function ProviderDetail"),
    source.indexOf("// ── ThinkingLevelMap editor"),
  );
  assert.match(providerDetail, /<HeaderListEditor/);
  assert.match(providerDetail, /headers=\{provider\.headers\}/);
  assert.match(providerDetail, /set\("headers", headers\)/);

  // Model-level compat toggles for custom OpenAI-compatible endpoints.
  assert.match(source, /getCompatBool\(model, "supportsDeveloperRole"\)/);
  assert.match(source, /setCompatBool\(model, "supportsDeveloperRole", v\)/);
  assert.match(source, /getCompatBool\(model, "sendSessionAffinityHeaders"\)/);
  assert.match(source, /setCompatBool\(model, "sendSessionAffinityHeaders", v\)/);
  assert.match(source, /getCompatStr\(model, "sessionAffinityFormat"\)/);
  assert.match(source, /options=\{\["openai", "openai-nosession", "openrouter"\]/);
});
