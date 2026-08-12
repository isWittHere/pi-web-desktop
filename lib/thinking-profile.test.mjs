import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const { buildThinkingProfile } = await createJiti(import.meta.url).import("./thinking-profile.ts");
const { buildProfileFromFields, supportedLevelsFromFields, describeThinkingRequestFromFields } = await createJiti(import.meta.url).import("./thinking-request-core.ts");

// 测试用的模型字段转 ThinkingModelFields
function fieldsOf(model) {
  return { api: model.api, reasoning: model.reasoning, compat: model.compat };
}
function specOf(model, level) {
  return describeThinkingRequestFromFields(fieldsOf(model), level, model.thinkingLevelMap ?? {});
}

// ── 用户实际配置场景（reqtoken 等自定义 OpenAI 兼容 provider） ────────────────

const gpt52 = {
  id: "gpt-5.2", provider: "reqtoken", api: "openai-completions", reasoning: true,
  thinkingLevelMap: { xhigh: "xhigh" },
  compat: { supportsReasoningEffort: true },
};

const gpt56 = {
  id: "gpt-5.6", provider: "reqtoken", api: "openai-completions", reasoning: true,
  thinkingLevelMap: { xhigh: "xhigh", max: "max" },
  compat: { supportsReasoningEffort: true },
};

const deepseek = {
  id: "deepseek-v4-flash", provider: "QNAIGC", api: "openai-completions", reasoning: true,
  thinkingLevelMap: {},
  compat: { thinkingFormat: "deepseek", requiresReasoningContentOnAssistantMessages: true },
};

const claudeFable5 = {
  id: "claude-fable-5", provider: "anthropic", api: "anthropic-messages", reasoning: true,
  thinkingLevelMap: { off: null, xhigh: "xhigh", max: "max" },
  compat: { forceAdaptiveThinking: true },
};

const claudeOld = {
  id: "claude-sonnet-4", provider: "anthropic", api: "anthropic-messages", reasoning: true,
  thinkingLevelMap: {},
};

const gptResponses = {
  id: "gpt-5", provider: "openai", api: "openai-responses", reasoning: true,
  thinkingLevelMap: { off: "none" },
};

test("gpt-5.2: xhigh mapped, max not mapped → levels exclude max", () => {
  const profile = buildThinkingProfile(gpt52);
  assert.deepEqual(profile.levels, ["off", "minimal", "low", "medium", "high", "xhigh"]);
  // 请求：xhigh 发送原样 effort
  assert.deepEqual(profile.requests.xhigh, { kind: "effort", effort: "xhigh" });
  // off 走标准 OpenAI：map.off 未配置 → "none"
  assert.deepEqual(profile.requests.off, { kind: "effort", effort: "none" });
});test("gpt-5.6: max mapped → max available", () => {
  const profile = buildThinkingProfile(gpt56);
  assert.ok(profile.levels.includes("max"));
  assert.deepEqual(profile.requests.max, { kind: "effort", effort: "max" });
});

test("deepseek（thinkingFormat）: 等级映射为开关请求", () => {
  const profile = buildThinkingProfile(deepseek);
  // 请求为 toggle（等级仍保留在 levels 中，选择器照常显示）
  assert.deepEqual(profile.requests.high, { kind: "toggle", enabled: true });
  assert.deepEqual(profile.requests.off, { kind: "toggle", enabled: false });
});

test("anthropic forceAdaptiveThinking: effort mapping with defaults", () => {
  const profile = buildThinkingProfile(claudeFable5);
  // off:null → 不可关闭
  assert.deepEqual(profile.requests.off, { kind: "off" });
  assert.deepEqual(profile.requests.high, { kind: "effort", effort: "high" });
  assert.deepEqual(profile.requests.max, { kind: "effort", effort: "max" });
  // levels 无 off
  assert.ok(!profile.levels.includes("off"));
});

test("anthropic budget mode: budget scales with level", () => {
  const profile = buildThinkingProfile(claudeOld);
  assert.deepEqual(profile.requests.minimal, { kind: "budget", budgetTokens: 1024 });
  assert.deepEqual(profile.requests.high, { kind: "budget", budgetTokens: 16384 });
  // xhigh/max clamp 到 high budget
  assert.deepEqual(profile.requests.xhigh, { kind: "budget", budgetTokens: 16384 });
});

test("openai-responses: effort mapping, off→none", () => {
  const profile = buildThinkingProfile(gptResponses);
  assert.deepEqual(profile.requests.off, { kind: "effort", effort: "none" });
  assert.deepEqual(profile.requests.high, { kind: "effort", effort: "high" });
});

test("non-reasoning model: only off", () => {
  const model = { id: "plain", provider: "x", api: "openai-completions", reasoning: false, thinkingLevelMap: {} };
  const profile = buildThinkingProfile(model);
  assert.deepEqual(profile.levels, ["off"]);
});

// ── thinkingFormat 特化分支（镜像 openai-completions.js） ─────────────────────

const zaiModel = {
  id: "glm-5.2", provider: "zai", api: "openai-completions", reasoning: true,
  thinkingLevelMap: {}, compat: { thinkingFormat: "zai", supportsReasoningEffort: true },
};
const zaiNoEffort = {
  id: "glm-5.2", provider: "zai", api: "openai-completions", reasoning: true,
  thinkingLevelMap: {}, compat: { thinkingFormat: "zai" },
};
const openrouterModel = {
  id: "x", provider: "openrouter", api: "openai-completions", reasoning: true,
  thinkingLevelMap: {}, compat: { thinkingFormat: "openrouter", supportsReasoningEffort: true },
};

for (const [name, model] of Object.entries({ zai: zaiModel, openrouter: openrouterModel })) {
  test(`${name}: supportsReasoningEffort → effort 发送映射值`, () => {
    const spec = specOf(model, "high");
    assert.deepEqual(spec, { kind: "effort", effort: "high" });
  });
}

test("zai without supportsReasoningEffort: 仅开关", () => {
  assert.deepEqual(specOf(zaiNoEffort, "high"), { kind: "toggle", enabled: true });
  assert.deepEqual(specOf(zaiNoEffort, "off"), { kind: "toggle", enabled: false });
});

// ── 客户端编辑态预览（buildProfileFromFields） ─────────────────────────────────

test("buildProfileFromFields 与服务端 buildThinkingProfile 结果一致（同一 meta+map）", () => {
  const service = buildThinkingProfile(gpt52);
  const client = buildProfileFromFields(service.meta, { xhigh: "xhigh" });
  assert.deepEqual(client.levels, service.levels);
  assert.deepEqual(client.requests.xhigh, service.requests.xhigh);
});

test("编辑态预览：给 gpt-5.2 添加 max 映射后 levels 出现 max", () => {
  const base = buildThinkingProfile(gpt52);
  const edited = buildProfileFromFields(base.meta, { xhigh: "xhigh", max: "max" });
  assert.ok(edited.levels.includes("max"));
  assert.deepEqual(edited.requests.max, { kind: "effort", effort: "max" });
});

test("supportedLevelsFromFields: off:null 隐藏 off；xhigh/max 未映射隐藏", () => {
  assert.deepEqual(
    supportedLevelsFromFields({ api: "openai-completions", reasoning: true }, { off: null }),
    ["minimal", "low", "medium", "high"],
  );
  assert.deepEqual(
    supportedLevelsFromFields({ reasoning: false }, {}),
    ["off"],
  );
});
