import type { ModelThinkingProfile } from "./thinking-request-core";

export interface ModelsData {
  models: Record<string, string>;
  modelList: { id: string; name: string; provider: string; api?: string }[];
  defaultModel: { provider: string; modelId: string } | null;
  /** settings.json 持久化的全局默认 thinking level（最近一次使用，无 per-model 记忆时兑底）。 */
  defaultThinkingLevel?: string;
  /** `provider/modelId` → thinking level pinned by an enabledModels suffix. */
  thinkingLevelPins: Record<string, string>;
  /** `provider:modelId` → 权威推理强度 profile（levels/map/requests）。 */
  thinkingProfiles?: Record<string, ModelThinkingProfile>;
  /** `provider/modelId` → 上次使用该模型时实际生效的推理强度。 */
  thinkingLevelMemory?: Record<string, string>;
  /** `provider/modelId` → whether the model accepts image input (Model.input). */
  imageInput: Record<string, boolean>;
  /** Resolver diagnostics when an enabledModels pattern matched no model. */
  modelScopeWarnings?: string[];
}

interface ModelsCacheState {
  entries: Map<string, { data: ModelsData; expiresAt: number }>;
  inFlight: Map<string, Promise<ModelsData>>;
  generation: number;
}

declare global {
  var __piModelsCacheState: ModelsCacheState | undefined;
}

const MODELS_CACHE_TTL_MS = 60_000;
const MAX_MODELS_CACHE_ENTRIES = 32;

function getModelsCacheState(): ModelsCacheState {
  if (!globalThis.__piModelsCacheState) {
    globalThis.__piModelsCacheState = {
      entries: new Map(),
      inFlight: new Map(),
      generation: 0,
    };
  }
  return globalThis.__piModelsCacheState;
}

export function invalidateModelsCache(): void {
  const state = getModelsCacheState();
  state.generation += 1;
  state.entries.clear();
  state.inFlight.clear();
}

export function loadModelsWithCache(cwd: string, loader: () => Promise<ModelsData>): Promise<ModelsData> {
  const state = getModelsCacheState();
  const cached = state.entries.get(cwd);
  if (cached) {
    if (cached.expiresAt > Date.now()) return Promise.resolve(cached.data);
    state.entries.delete(cwd);
  }

  const existingLoad = state.inFlight.get(cwd);
  if (existingLoad) return existingLoad;

  const generation = state.generation;
  const loadPromise: Promise<ModelsData> = Promise.resolve()
    .then(loader)
    .then((data) => {
      if (state.generation === generation && state.inFlight.get(cwd) === loadPromise) {
        const now = Date.now();
        for (const [key, entry] of state.entries) {
          if (entry.expiresAt <= now) state.entries.delete(key);
        }
        while (state.entries.size >= MAX_MODELS_CACHE_ENTRIES) {
          const oldestKey = state.entries.keys().next().value;
          if (oldestKey === undefined) break;
          state.entries.delete(oldestKey);
        }
        state.entries.set(cwd, { data, expiresAt: now + MODELS_CACHE_TTL_MS });
      }
      return data;
    })
    .finally(() => {
      if (state.inFlight.get(cwd) === loadPromise) state.inFlight.delete(cwd);
    });

  state.inFlight.set(cwd, loadPromise);
  return loadPromise;
}
