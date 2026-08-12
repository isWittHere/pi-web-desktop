/**
 * 推理强度请求描述的**纯逻辑**核心（无 pi-ai / Node 依赖，客户端与服务端共用）。
 *
 * 这是对 pi-ai 各 `api/*.js` 请求构造逻辑的**只读镜像**，仅用于展示与一致化
 * （配置页逐行显示"实际会发什么"、编辑态实时预览）。真正请求仍由 SDK 构造。
 * SDK 升级时需对照 `node_modules/@earendil-works/pi-ai/dist/api/*.js` 校验，
 * 并通过 `lib/thinking-profile.test.mjs` 固化关键分支断言。
 */
import { THINKING_LEVELS, type ThinkingLevel } from "./thinking-levels";

/** 单个等级实际构造的请求参数描述。 */
export type ThinkingRequestSpec =
  | { kind: "effort"; effort: string; budgetTokens?: number }
  | { kind: "toggle"; enabled: boolean; effort?: string }
  | { kind: "budget"; budgetTokens: number }
  /** 模型不支持关闭思考（map.off === null），off 档不可用。 */
  | { kind: "off" };

/** 计算 profile 所需的模型字段（不依赖完整 Model 对象）。 */
export interface ThinkingModelFields {
  api?: string;
  reasoning?: boolean;
  compat?: Record<string, unknown>;
}

export interface ModelThinkingProfile {
  /** 权威支持表 = getSupportedThinkingLevels 结果，随 reasoning + thinkingLevelMap 实时变化。 */
  levels: string[];
  /** 有效映射（provider 默认 + 用户 models.json 合并后）。 */
  map: Record<string, string | null>;
  /** 全部 7 个抽象等级各自的实际请求描述（配置页逐行展示）。 */
  requests: Record<string, ThinkingRequestSpec>;
  /** 计算该 profile 所需的模型字段（供编辑态实时预览复用）。 */
  meta: ThinkingModelFields;
}

/** budget 模式各档预算（镜像 pi-ai simple-options.js adjustMaxTokensForThinking）。 */
const BUDGET_TOKENS: Record<string, number> = {
  minimal: 1024,
  low: 2048,
  medium: 8192,
  high: 16384,
};

function clampToBudgetLevel(level: string): string {
  if (level in BUDGET_TOKENS) return level;
  const index = THINKING_LEVELS.indexOf(level as ThinkingLevel);
  if (index === -1) return "medium";
  for (let i = index + 1; i < THINKING_LEVELS.length; i++) {
    if (THINKING_LEVELS[i] in BUDGET_TOKENS) return THINKING_LEVELS[i];
  }
  for (let i = index - 1; i >= 0; i--) {
    if (THINKING_LEVELS[i] in BUDGET_TOKENS) return THINKING_LEVELS[i];
  }
  return "medium";
}

/**
 * 权威支持表（镜像 pi-ai getSupportedThinkingLevels）：
 * - off 映射 null → 不支持
 * - xhigh/max 未显式映射 → 不支持
 */
export function supportedLevelsFromFields(
  model: ThinkingModelFields,
  map: Record<string, string | null>,
): string[] {
  if (!model.reasoning) return ["off"];
  return THINKING_LEVELS.filter((level) => {
    const mapped = map[level];
    if (mapped === null) return false;
    if (level === "xhigh" || level === "max") return mapped !== undefined;
    return true;
  });
}

interface CompatShape {
  thinkingFormat?: unknown;
  supportsReasoningEffort?: unknown;
  supportsThinkingTokenBudget?: unknown;
  forceAdaptiveThinking?: unknown;
}

function describeOpenAiCompletions(
  model: ThinkingModelFields,
  level: string,
  map: Record<string, string | null>,
  compat: CompatShape,
): ThinkingRequestSpec {
  const effortEnabled = compat.supportsReasoningEffort === true;
  const budgetEnabled = compat.supportsThinkingTokenBudget === true;
  const format = compat.thinkingFormat;

  if (level === "off") {
    if (map.off === null) return { kind: "off" };
    if (format === "deepseek") return { kind: "toggle", enabled: false };
    if (effortEnabled) return { kind: "effort", effort: map.off ?? "none" };
    return { kind: "toggle", enabled: false };
  }

  // thinkingFormat 特化分支：只有 supportsReasoningEffort 才携带 effort，否则仅开关。
  if (format && format !== "chat-template" && format !== "qwen-chat-template") {
    if (!effortEnabled) return { kind: "toggle", enabled: true };
    return { kind: "effort", effort: map[level] ?? level };
  }

  // 默认（标准 OpenAI 兼容）。
  if (effortEnabled) {
    const effort = map[level] ?? level;
    if (budgetEnabled) {
      return { kind: "effort", effort, budgetTokens: BUDGET_TOKENS[clampToBudgetLevel(level)] ?? 8192 };
    }
    return { kind: "effort", effort };
  }
  return { kind: "toggle", enabled: true };
}

function describeOpenAiResponses(
  _model: ThinkingModelFields,
  level: string,
  map: Record<string, string | null>,
): ThinkingRequestSpec {
  if (level === "off") {
    if (map.off === null) return { kind: "off" };
    return { kind: "effort", effort: map.off ?? "none" };
  }
  return { kind: "effort", effort: map[level] ?? level };
}

/** anthropic 自适应 thinking 的默认 effort 表（镜像 anthropic-messages.js mapThinkingLevelToEffort）。 */
function anthropicDefaultEffort(level: string): string {
  if (level === "minimal" || level === "low") return "low";
  if (level === "medium") return "medium";
  if (level === "high") return "high";
  return "high";
}

function describeAnthropic(
  _model: ThinkingModelFields,
  level: string,
  map: Record<string, string | null>,
  compat: CompatShape,
): ThinkingRequestSpec {
  if (level === "off") {
    if (map.off === null) return { kind: "off" };
    return { kind: "toggle", enabled: false };
  }
  if (compat.forceAdaptiveThinking === true) {
    return { kind: "effort", effort: map[level] ?? anthropicDefaultEffort(level) };
  }
  // budget 模式：预算随等级变化。
  return { kind: "budget", budgetTokens: BUDGET_TOKENS[clampToBudgetLevel(level)] ?? 1024 };
}

function describeGoogle(
  _model: ThinkingModelFields,
  level: string,
  map: Record<string, string | null>,
): ThinkingRequestSpec {
  if (level === "off") {
    if (map.off === null) return { kind: "off" };
    return { kind: "toggle", enabled: false };
  }
  return {
    kind: "effort",
    effort: map[level] ?? (level === "off" ? "high" : level),
    budgetTokens: BUDGET_TOKENS[clampToBudgetLevel(level)] ?? 8192,
  };
}

export function describeThinkingRequestFromFields(
  model: ThinkingModelFields,
  level: string,
  map: Record<string, string | null>,
): ThinkingRequestSpec {
  const compat = (model.compat ?? {}) as CompatShape;
  switch (model.api) {
    case "openai-completions":
      return describeOpenAiCompletions(model, level, map, compat);
    case "openai-responses":
    case "azure-openai-responses":
    case "openai-codex-responses":
      return describeOpenAiResponses(model, level, map);
    case "anthropic-messages":
      return describeAnthropic(model, level, map, compat);
    case "google-generative-ai":
      return describeGoogle(model, level, map);
    default:
      return { kind: "effort", effort: map[level] ?? level };
  }
}

/** 用模型字段 + 映射构建完整 profile（服务端 buildThinkingProfile 与客户端编辑态预览共用）。 */
export function buildProfileFromFields(
  model: ThinkingModelFields,
  map: Record<string, string | null>,
): ModelThinkingProfile {
  return {
    levels: supportedLevelsFromFields(model, map),
    map,
    requests: Object.fromEntries(
      THINKING_LEVELS.map((level) => [level, describeThinkingRequestFromFields(model, level, map)]),
    ),
    meta: model,
  };
}
