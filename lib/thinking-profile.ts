/**
 * 服务端入口：把 pi-ai 的 `Model<Api>` 转成推理强度 Profile。
 *
 * 纯逻辑在 `lib/thinking-request-core.ts`（无 pi-ai 依赖，客户端编辑态预览共用），
 * 本文件只负责把 Model 适配为 ThinkingModelFields。等级支持表由
 * `supportedLevelsFromFields` 计算（镜像 pi-ai getSupportedThinkingLevels，
 * 一致性由 lib/thinking-profile.test.mjs 断言保证）。
 */
import type { Api, Model } from "@earendil-works/pi-ai";
import {
  buildProfileFromFields,
  type ModelThinkingProfile,
} from "./thinking-request-core";

export type { ModelThinkingProfile } from "./thinking-request-core";

function toFields(model: Model<Api>) {
  return {
    api: model.api,
    reasoning: model.reasoning,
    compat: (model.compat ?? {}) as Record<string, unknown>,
  };
}

/** 权威 profile（levels/map/requests/meta）。 */
export function buildThinkingProfile(model: Model<Api>): ModelThinkingProfile {
  const map = (model.thinkingLevelMap ?? {}) as Record<string, string | null>;
  return buildProfileFromFields(toFields(model), map);
}
