import { stat } from "fs/promises";
import { resolve } from "path";
import { createAgentSessionServices, getAgentDir, type SettingsManager } from "@earendil-works/pi-coding-agent";
import {
  loadModelsWithCache,
  withModelRuntimeError,
  withSafeModelLoadFailure,
  type ModelsData,
} from "@/lib/models-cache";
import { resolveVisibleModels, selectInitialModelScope } from "@/lib/model-scope";
import { projectTrustReloadOptions } from "@/lib/project-trust";
import { buildThinkingProfile } from "@/lib/thinking-profile";
import type { ModelThinkingProfile } from "@/lib/thinking-request-core";
import { getThinkingLevelMemory } from "@/lib/thinking-level-memory";

export const dynamic = "force-dynamic";

const modelNameCollator = new Intl.Collator(undefined, { numeric: true, sensitivity: "base" });

function compareModelEntries(
  a: { id: string; name: string; provider: string },
  b: { id: string; name: string; provider: string },
): number {
  return modelNameCollator.compare(a.name || a.id, b.name || b.id)
    || modelNameCollator.compare(a.provider, b.provider)
    || modelNameCollator.compare(a.id, b.id);
}

async function loadModels(cwd: string): Promise<ModelsData> {
  const nameMap = new Map<string, string>();
  const thinkingProfiles: Record<string, ModelThinkingProfile> = {};
  const imageInput: Record<string, boolean> = {};

  const agentDir = getAgentDir();
  // Model enumeration imports project extensions to discover their providers.
  // Gate that import before repository-controlled factories can execute.
  const trustReloadOptions = projectTrustReloadOptions(cwd, agentDir);
  const services = await createAgentSessionServices({
    cwd,
    agentDir,
    ...(trustReloadOptions ? { resourceLoaderReloadOptions: trustReloadOptions } : {}),
  });
  const settings: SettingsManager = services.settingsManager;
  const scope = await resolveVisibleModels(
    services.modelRuntime,
    settings.getEnabledModels(),
  );
  const modelError = services.modelRuntime.getError();
  const modelList = scope.visible.map((model) => ({
    id: model.id,
    name: model.name,
    provider: model.provider,
    api: model.api,
  })).sort(compareModelEntries);

  for (const model of scope.visible) {
    const key = `${model.provider}:${model.id}`;
    nameMap.set(key, model.name);
    thinkingProfiles[key] = buildThinkingProfile(model);
    imageInput[key] = model.input.includes("image");
  }

  const defaultProvider = settings.getDefaultProvider();
  const defaultModelId = settings.getDefaultModel();
  const initial = selectInitialModelScope(scope, {
    ...(defaultProvider && defaultModelId
      ? { defaultModel: { provider: defaultProvider, modelId: defaultModelId } }
      : {}),
  });

  return withModelRuntimeError(
    {
      models: Object.fromEntries(nameMap),
      modelList,
      defaultModel: initial.model
        ? { provider: initial.model.provider, modelId: initial.model.id }
        : null,
      defaultThinkingLevel: settings.getDefaultThinkingLevel() ?? undefined,
      thinkingLevelPins: scope.thinkingLevelPins,
      thinkingProfiles,
      thinkingLevelMemory: getThinkingLevelMemory(),
      imageInput,
      ...(scope.warnings.length > 0 ? { modelScopeWarnings: scope.warnings } : {}),
    },
    modelError,
  );
}

const EMPTY_MODELS: ModelsData = {
  models: {},
  modelList: [],
  defaultModel: null,
  thinkingLevelPins: {},
  imageInput: {},
};

export async function GET(req: Request) {
  const requestedCwd = new URL(req.url).searchParams.get("cwd") || process.cwd();
  const cwd = resolve(requestedCwd);

  let cwdStat;
  try {
    cwdStat = await stat(cwd);
  } catch {
    return Response.json({ error: `Directory does not exist: ${cwd}` }, { status: 400 });
  }
  if (!cwdStat.isDirectory()) {
    return Response.json({ error: `Not a directory: ${cwd}` }, { status: 400 });
  }

  try {
    return Response.json(await loadModelsWithCache(cwd, () => loadModels(cwd)));
  } catch {
    return Response.json(withSafeModelLoadFailure(EMPTY_MODELS));
  }
}
