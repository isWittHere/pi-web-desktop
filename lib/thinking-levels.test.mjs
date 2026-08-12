import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const { filterThinkingLevelOptions, THINKING_LEVEL_OPTIONS, modelKey, modelProfileKey } =
  await createJiti(import.meta.url).import("./thinking-levels.ts");

test("filterThinkingLevelOptions: 始终包含 auto，且档位 = 模型支持表", () => {
  const levels = ["off", "minimal", "low", "medium", "high"]; // deepseek 类（无 xhigh/max）
  const result = filterThinkingLevelOptions(levels);
  assert.ok(result.includes("auto"));
  assert.deepEqual(result, ["high", "medium", "low", "minimal", "auto", "off"]);
});

test("filterThinkingLevelOptions: 支持 xhigh/max 时档位完整", () => {
  const levels = ["off", "minimal", "low", "medium", "high", "xhigh", "max"];
  const result = filterThinkingLevelOptions(levels);
  assert.deepEqual(result, THINKING_LEVEL_OPTIONS);
});

test("filterThinkingLevelOptions: availableLevels 为 null（无数据）时显示全部档位", () => {
  assert.deepEqual(filterThinkingLevelOptions(null), THINKING_LEVEL_OPTIONS);
  assert.deepEqual(filterThinkingLevelOptions(undefined), THINKING_LEVEL_OPTIONS);
});

test("filterThinkingLevelOptions: 5 档（无 xhigh/max）时档位完整显示", () => {
  // deepseek 类模型：levels 只有 5 档，必须全部出现（等级列表=模型支持表，不额外裁剪）
  const levels = ["off", "minimal", "low", "medium", "high"];
  assert.equal(filterThinkingLevelOptions(levels).length, 6); // 5 档 + auto
});

test("key 分隔符约定", () => {
  assert.equal(modelKey("reqtoken", "gpt-5.6"), "reqtoken/gpt-5.6");
  assert.equal(modelProfileKey("reqtoken", "gpt-5.6"), "reqtoken:gpt-5.6");
});
