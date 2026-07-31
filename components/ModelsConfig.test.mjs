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
