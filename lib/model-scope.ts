import type { ThinkingLevel } from "@earendil-works/pi-agent-core";
import {
  resolveModelScopeWithDiagnostics,
  type ModelRuntime,
  type ScopedModel,
} from "@earendil-works/pi-coding-agent";
import type { Api, Model } from "@earendil-works/pi-ai";

const THINKING_LEVEL_SUFFIXES = new Set<ThinkingLevel>([
  "off",
  "minimal",
  "low",
  "medium",
  "high",
  "xhigh",
  "max",
]);

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

function hasGlob(pattern: string): boolean {
  return pattern.includes("*") || pattern.includes("?") || pattern.includes("[");
}

/**
 * A leftover enabledModels glob after a model was retired/deleted is not a
 * chat-level problem when other entries still matched. Keep exact and malformed
 * pattern warnings, and keep no-match warnings for a total miss (where the UI
 * falls back to every model and must know the scope did not apply).
 * Mirrors upstream f607816.
 */
function isSuppressibleUnmatchedGlob(pattern: string): boolean {
  if (!hasGlob(pattern)) return false;
  const colonIndex = pattern.lastIndexOf(":");
  return colonIndex < 0
    || THINKING_LEVEL_SUFFIXES.has(pattern.slice(colonIndex + 1) as ThinkingLevel);
}

function exactReferenceMatches(pattern: string, models: readonly Model<Api>[]): Model<Api>[] {
  const normalized = pattern.toLowerCase();
  const canonical = models.filter(
    (model) => `${model.provider}/${model.id}`.toLowerCase() === normalized,
  );
  if (canonical.length > 0) return canonical;
  return models.filter((model) => model.id.toLowerCase() === normalized);
}

function assertNoAmbiguousExactPatterns(
  patterns: readonly string[],
  models: readonly Model<Api>[],
): void {
  for (const pattern of patterns) {
    if (hasGlob(pattern)) continue;

    let matches = exactReferenceMatches(pattern, models);
    if (matches.length === 0) {
      const colonIndex = pattern.lastIndexOf(":");
      const suffix = colonIndex >= 0 ? pattern.slice(colonIndex + 1) : "";
      if (THINKING_LEVEL_SUFFIXES.has(suffix as ThinkingLevel)) {
        matches = exactReferenceMatches(pattern.slice(0, colonIndex), models);
      }
    }

    if (matches.length > 1) {
      const references = matches
        .map((model) => `${model.provider}/${model.id}`)
        .sort()
        .join(", ");
      throw new Error(
        `Ambiguous enabledModels entry "${pattern}" matches multiple models: ${references}. Use provider/modelId.`,
      );
    }
  }
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

  const available = await modelRuntime.getAvailable();
  assertNoAmbiguousExactPatterns(cleanedPatterns, available);
  const snapshotRuntime = {
    getAvailable: async () => available,
  } as ModelRuntime;
  const { scopedModels, diagnostics } = await resolveModelScopeWithDiagnostics(cleanedPatterns, snapshotRuntime);
  // A leftover valid glob after a model removal is not a chat-level problem when
  // other enabledModels entries still matched; keep exact/malformed warnings and
  // all no-match warnings on a total miss. (f607816)
  const warnings = diagnostics
    .filter((diagnostic) => (
      diagnostic.code !== "no-match"
      || scopedModels.length === 0
      || !isSuppressibleUnmatchedGlob(diagnostic.pattern)
    ))
    .map((diagnostic) => diagnostic.message);
  if (scopedModels.length === 0) {
    return {
      visible: available,
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
