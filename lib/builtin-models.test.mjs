import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const { getBuiltinModelCatalog, findBuiltinModelConflicts } = await createJiti(import.meta.url).import("./builtin-models.ts");

test("内置目录包含常见 provider（anthropic/openai/google）", () => {
  const catalog = getBuiltinModelCatalog();
  const anthropic = catalog.get("anthropic");
  const openai = catalog.get("openai");
  assert.ok(anthropic && anthropic.size > 0, "anthropic 内置模型应存在");
  assert.ok(openai && openai.size > 0, "openai 内置模型应存在");
  assert.ok(anthropic.has("claude-sonnet-4-6") || anthropic.size >= 10, "anthropic 应有 claude 模型");
});

test("findBuiltinModelConflicts 识别与内置模型同名的 models[] 条目", () => {
  const conflicts = findBuiltinModelConflicts({
    anthropic: { models: [{ id: "claude-sonnet-4-6" }, { id: "custom-model" }] },
    reqtoken: { models: [{ id: "gpt-5.6" }] }, // 非内置 provider 不误报
  });
  assert.deepEqual(conflicts, ["anthropic/claude-sonnet-4-6"]);
});

test("无冲突时返回空数组", () => {
  assert.deepEqual(findBuiltinModelConflicts({}), []);
  assert.deepEqual(findBuiltinModelConflicts({ custom: { models: [{ id: "m1" }] } }), []);
});
