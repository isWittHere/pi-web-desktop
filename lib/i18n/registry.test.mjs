import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url);
const { getLocalePlugin, getSupportedLocales, resolveBrowserLocale } = await jiti.import("./registry.ts");

test("registers the built-in locales in a stable order", () => {
  assert.deepEqual(getSupportedLocales(), ["en", "zh-CN"]);
  assert.equal(getLocalePlugin("en")?.label, "English");
  assert.equal(getLocalePlugin("zh-CN")?.label, "简体中文");
});

test("selects the first supported browser language and falls back to English", () => {
  assert.equal(resolveBrowserLocale(["zh-CN", "en-US"]), "zh-CN");
  assert.equal(resolveBrowserLocale(["en-US", "zh-CN"]), "en");
  assert.equal(resolveBrowserLocale(["fr-FR", "zh-CN"]), "zh-CN");
  assert.equal(resolveBrowserLocale(["fr-FR"]), "en");
});
