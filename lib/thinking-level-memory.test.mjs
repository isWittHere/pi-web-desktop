import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createJiti } from "jiti";

const dir = mkdtempSync(join(tmpdir(), "pi-web-thinking-memory-"));
process.env.PI_CODING_AGENT_DIR = dir;

const { getThinkingLevelMemory, rememberThinkingLevel } = await createJiti(import.meta.url).import("./thinking-level-memory.ts");

test("remembers and reads per-model levels", () => {
  rememberThinkingLevel("reqtoken/gpt-5.6", "high");
  rememberThinkingLevel("reqtoken/gpt-5.2", "xhigh");

  const memory = getThinkingLevelMemory();
  assert.deepEqual(memory, {
    "reqtoken/gpt-5.6": "high",
    "reqtoken/gpt-5.2": "xhigh",
  });

  // 文件真实落盘（原子写）
  const raw = JSON.parse(readFileSync(join(dir, "pi-web-preferences.json"), "utf8"));
  assert.equal(raw.thinkingLevelMemory["reqtoken/gpt-5.6"], "high");
});

test("updates overwrite the previous level for the same model", () => {
  rememberThinkingLevel("reqtoken/gpt-5.6", "medium");
  assert.equal(getThinkingLevelMemory()["reqtoken/gpt-5.6"], "medium");
});

test("empty memory returns an empty record", () => {
  // 独立目录验证初始为空
  const dir2 = mkdtempSync(join(tmpdir(), "pi-web-thinking-memory2-"));
  process.env.PI_CODING_AGENT_DIR = dir2;
  assert.deepEqual(getThinkingLevelMemory(), {});
});

// 清理临时目录
test.after(() => {
  rmSync(dir, { recursive: true, force: true });
});
