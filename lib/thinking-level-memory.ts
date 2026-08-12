/**
 * 服务端 per-model 推理强度记忆。
 *
 * 独立存储于 `~/.pi/agent/pi-web-preferences.json`，不动 pi CLI 的 settings.json
 * schema（SDK 可能重写 settings.json）。只记录**实际生效**的等级
 * （SDK clamp 后），key 为 `${provider}/${modelId}`。
 */
import { existsSync, mkdirSync, readFileSync } from "fs";
import { dirname, join } from "path";
import { getAgentDir } from "@earendil-works/pi-coding-agent";
import { writePrivateFileAtomicSync } from "./atomic-file";

const MEMORY_KEY = "thinkingLevelMemory";

export interface PiWebPreferences {
  thinkingLevelMemory?: Record<string, string>;
}

function getPreferencesPath(): string {
  return join(getAgentDir(), "pi-web-preferences.json");
}

function readPreferences(): PiWebPreferences {
  const path = getPreferencesPath();
  if (!existsSync(path)) return {};
  try {
    return JSON.parse(readFileSync(path, "utf8")) as PiWebPreferences;
  } catch {
    return {};
  }
}

function writePreferences(preferences: PiWebPreferences): void {
  const path = getPreferencesPath();
  const directory = dirname(path);
  if (!existsSync(directory)) mkdirSync(directory, { recursive: true });
  writePrivateFileAtomicSync(path, JSON.stringify(preferences, null, 2));
}

/** 读全部 per-model 记忆（`provider/modelId` → 等级）。 */
export function getThinkingLevelMemory(): Record<string, string> {
  return readPreferences()[MEMORY_KEY] ?? {};
}

/** 记录某模型实际生效的推理强度（原子写）。 */
export function rememberThinkingLevel(modelKey: string, level: string): void {
  const preferences = readPreferences();
  const memory = { ...(preferences[MEMORY_KEY] ?? {}) };
  memory[modelKey] = level;
  writePreferences({ ...preferences, [MEMORY_KEY]: memory });
}

/** 清除某模型的记忆（不存在则不变）。 */
export function forgetThinkingLevel(modelKey: string): void {
  const preferences = readPreferences();
  const memory = { ...(preferences[MEMORY_KEY] ?? {}) };
  if (!(modelKey in memory)) return;
  delete memory[modelKey];
  if (Object.keys(memory).length === 0) {
    const rest = { ...preferences };
    delete rest[MEMORY_KEY];
    writePreferences(rest);
  } else {
    writePreferences({ ...preferences, [MEMORY_KEY]: memory });
  }
}
