import type { ThinkingLevel } from "@earendil-works/pi-agent-core";
import {
  resolveModelScopeWithDiagnostics,
  type ModelRuntime,
  type ScopedModel,
} from "@earendil-works/pi-coding-agent";
import type { Api, Model } from "@earendil-works/pi-ai";

/**
 * Uses pi's resolver so pi-web accepts the same enabledModels globs, fuzzy
 * references, and thinking pins as the CLI rather than maintaining a second
 * matcher with subtly different behavior.
 */
export interface ModelScopeResult {
  visible: readonly Model<Api>[];
  scopedModels: readonly ScopedModel[];
  thinkingLevelPins: Record<string, string>;
  warnings: string[];
}

export interface InitialModelScopeOptions {
  requestedModel?: { provider: string; modelId: string };
  defaultModel?: { provider: string; modelId: string };
  thinkingLevel?: ThinkingLevel;
}

export interface InitialModelScopeResult {
  model?: Model<Api>;
  thinkingLevel?: ThinkingLevel;
  scopedModels: ScopedModel[];
}

function matchesModel(
  model: { provider: string; id: string },
  reference: { provider: string; modelId: string },
): boolean {
  return model.provider === reference.provider && model.id === reference.modelId;
}

export async function resolveVisibleModels(
  modelRuntime: ModelRuntime,
  patterns: string[] | undefined,
): Promise<ModelScopeResult> {
  const cleanedPatterns = (patterns ?? []).map((pattern) => pattern.trim()).filter(Boolean);
  if (cleanedPatterns.length === 0) {
    return {
      visible: await modelRuntime.getAvailable(),
      scopedModels: [],
      thinkingLevelPins: {},
      warnings: [],
    };
  }

  const { scopedModels, diagnostics } = await resolveModelScopeWithDiagnostics(cleanedPatterns, modelRuntime);
  const warnings = diagnostics.map((diagnostic) => diagnostic.message);
  if (scopedModels.length === 0) {
    return {
      visible: await modelRuntime.getAvailable(),
      scopedModels: [],
      thinkingLevelPins: {},
      warnings,
    };
  }

  const thinkingLevelPins: Record<string, string> = {};
  for (const scopedModel of scopedModels) {
    if (scopedModel.thinkingLevel) {
      thinkingLevelPins[`${scopedModel.model.provider}/${scopedModel.model.id}`] = scopedModel.thinkingLevel;
    }
  }

  return {
    visible: scopedModels.map((scopedModel) => scopedModel.model),
    scopedModels,
    thinkingLevelPins,
    warnings,
  };
}

export function selectInitialModelScope(
  scope: ModelScopeResult,
  options: InitialModelScopeOptions = {},
): InitialModelScopeResult {
  const requested = options.requestedModel
    ? scope.visible.find((model) => matchesModel(model, options.requestedModel!))
    : undefined;
  if (options.requestedModel && !requested) {
    throw new Error(
      `Model is not available in the enabled scope: ${options.requestedModel.provider}/${options.requestedModel.modelId}`,
    );
  }

  const requestedScoped = requested
    ? scope.scopedModels.find((scopedModel) => matchesModel(scopedModel.model, {
      provider: requested.provider,
      modelId: requested.id,
    }))
    : undefined;
  const defaultScoped = !requested && options.defaultModel
    ? scope.scopedModels.find((scopedModel) => matchesModel(scopedModel.model, options.defaultModel!))
    : undefined;
  const fallbackScoped = !requested ? (defaultScoped ?? scope.scopedModels[0]) : undefined;
  const defaultVisible = !requested && !fallbackScoped && options.defaultModel
    ? scope.visible.find((model) => matchesModel(model, options.defaultModel!))
    : undefined;
  const model = requested ?? fallbackScoped?.model ?? defaultVisible;
  const scopedSelection = requestedScoped ?? fallbackScoped;
  const thinkingLevel = options.thinkingLevel ?? scopedSelection?.thinkingLevel;

  return {
    ...(model ? { model } : {}),
    ...(thinkingLevel ? { thinkingLevel } : {}),
    scopedModels: [...scope.scopedModels],
  };
}
