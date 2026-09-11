import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, { tsconfigPaths: true });
const {
  readCompatFlag,
  resolveCompatFlag,
  writeCompatFlag,
} = await jiti.import("./models-config-helpers.ts");

test("readCompatFlag only trusts real booleans", () => {
  assert.equal(readCompatFlag(undefined, "x"), undefined);
  assert.equal(readCompatFlag({}, "x"), undefined);
  assert.equal(readCompatFlag({ x: true }, "x"), true);
  assert.equal(readCompatFlag({ x: false }, "x"), false);
  assert.equal(readCompatFlag({ x: "false" }, "x"), undefined);
  assert.equal(readCompatFlag({ x: 0 }, "x"), undefined);
});

test("writeCompatFlag keeps an explicit false instead of dropping the key", () => {
  // pi resolves flags as `model.compat[key] ?? fallback`, so a default-true flag
  // such as supportsDeveloperRole must be persisted as false; deleting the key
  // would silently turn the developer role back on.
  assert.deepEqual(writeCompatFlag(undefined, "supportsDeveloperRole", false), {
    supportsDeveloperRole: false,
  });
  assert.deepEqual(writeCompatFlag({ thinkingFormat: "deepseek" }, "supportsDeveloperRole", false), {
    thinkingFormat: "deepseek",
    supportsDeveloperRole: false,
  });
  assert.deepEqual(writeCompatFlag({ supportsDeveloperRole: false }, "supportsDeveloperRole", true), {
    supportsDeveloperRole: true,
  });
});

test("writeCompatFlag removes only the inherit state and collapses empty maps", () => {
  assert.deepEqual(
    writeCompatFlag({ supportsDeveloperRole: false, thinkingFormat: "deepseek" }, "supportsDeveloperRole", undefined),
    { thinkingFormat: "deepseek" },
  );
  assert.equal(writeCompatFlag({ supportsDeveloperRole: true }, "supportsDeveloperRole", undefined), undefined);
});

test("developer role round-trips between inherit, developer and system", () => {
  const providerCompat = { supportsDeveloperRole: true };
  let modelCompat;

  // "system" writes an explicit false that beats the provider's developer role.
  modelCompat = writeCompatFlag(modelCompat, "supportsDeveloperRole", false);
  assert.deepEqual(resolveCompatFlag(modelCompat, providerCompat, "supportsDeveloperRole"), {
    origin: "model",
    value: false,
  });

  // "developer" writes an explicit true.
  modelCompat = writeCompatFlag(modelCompat, "supportsDeveloperRole", true);
  assert.deepEqual(resolveCompatFlag(modelCompat, providerCompat, "supportsDeveloperRole"), {
    origin: "model",
    value: true,
  });

  // "inherit" drops the override and follows the provider again.
  modelCompat = writeCompatFlag(modelCompat, "supportsDeveloperRole", undefined);
  assert.equal(modelCompat, undefined);
  assert.deepEqual(resolveCompatFlag(modelCompat, providerCompat, "supportsDeveloperRole"), {
    origin: "provider",
    value: true,
  });
});

test("resolveCompatFlag prefers the model, then the provider, then reports auto", () => {
  assert.deepEqual(resolveCompatFlag({ k: false }, { k: true }, "k"), { origin: "model", value: false });
  assert.deepEqual(resolveCompatFlag({}, { k: false }, "k"), { origin: "provider", value: false });
  assert.deepEqual(resolveCompatFlag(undefined, undefined, "k"), { origin: "auto" });
  // Non-boolean JSON values are ignored at both levels.
  assert.deepEqual(resolveCompatFlag({ k: "yes" }, { k: "no" }, "k"), { origin: "auto" });
});
