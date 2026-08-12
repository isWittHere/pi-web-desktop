/**
 * 推理强度（thinking level）的权威常量和 key 帮助函数。
 *
 * 这是配置页、输入框选择器、请求构造三方的**唯一**等级来源。
 * 顺序（升序）与 pi-ai `EXTENDED_THINKING_LEVELS` 保持一致。
 */

/** 权威抽象等级集合（升序）。 */
export const THINKING_LEVELS = [
  "off",
  "minimal",
  "low",
  "medium",
  "high",
  "xhigh",
  "max",
] as const;

export type ThinkingLevel = (typeof THINKING_LEVELS)[number];

/** 选择器伪等级（非 SDK 等级）：语义为"不干预，用服务端默认"。 */
export const AUTO_LEVEL = "auto" as const;

export type ThinkingLevelOption = ThinkingLevel | typeof AUTO_LEVEL;

/**
 * 选择器展示顺序：最强 → 最弱，auto 固定在 minimal 与 off 之间
 * （保持既有 UI 的展示顺序不变，仅消除与配置页的重复定义）。
 */
export const THINKING_LEVEL_OPTIONS = [
  ...THINKING_LEVELS.slice(1).reverse(),
  AUTO_LEVEL,
  "off",
] as const;

/**
 * key 分隔符约定：
 * - 模型级 pins / per-model 记忆用 `/`（`provider/modelId`）
 * - levels / maps / profiles 缓存用 `:`（`provider:modelId`）
 */
export function modelKey(provider: string, modelId: string): string {
  return `${provider}/${modelId}`;
}

export function modelProfileKey(provider: string, modelId: string): string {
  return `${provider}:${modelId}`;
}

/**
 * 选择器显示的档位：auto 恒显示；availableLevels 为 null（暂无 profile 数据）时显示全部。
 * 等级列表始终等于模型支持表（配置页可见），不做任何额外裁剪。
 */
export function filterThinkingLevelOptions(
  availableLevels: string[] | null | undefined,
): ThinkingLevelOption[] {
  return THINKING_LEVEL_OPTIONS.filter((lvl) => {
    if (lvl === "auto") return true;
    if (!availableLevels) return true;
    return availableLevels.includes(lvl);
  });
}
