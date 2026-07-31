import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const { normalizePluginSourceInput } = await createJiti(import.meta.url, {
  jsx: { runtime: "automatic" },
  tsconfigPaths: true,
}).import("./PluginsConfig.tsx");

test("normalizes pasted pi install commands to their package source", () => {
  assert.equal(normalizePluginSourceInput("pi install npm:@scope/plugin"), "npm:@scope/plugin");
  assert.equal(normalizePluginSourceInput("$ pi install git:https://example.test/repo"), "git:https://example.test/repo");
  assert.equal(normalizePluginSourceInput("npm:@scope/plugin"), "npm:@scope/plugin");
});
