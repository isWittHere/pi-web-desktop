import type { ThinkingLevel } from "@earendil-works/pi-agent-core";
import type { SettingsManager } from "@earendil-works/pi-coding-agent";

export interface ExplicitStartupPreferences {
  model?: { provider: string; modelId: string };
  thinkingLevel?: ThinkingLevel;
}

export interface EffectiveStartupPreferences {
  model?: { provider: string; modelId: string };
  thinkingLevel: ThinkingLevel;
  supportsThinking: boolean;
}

/**
 * Persist explicit browser selections without re-running AgentSession setters.
 *
 * The session constructor already records the effective model and thinking
 * level. Calling setModel()/setThinkingLevel() again would append duplicate
 * session entries and emit duplicate extension events.
 */
export async function persistExplicitStartupPreferences(
  settingsManager: SettingsManager,
  explicit: ExplicitStartupPreferences,
  effective: EffectiveStartupPreferences,
): Promise<{ modelDefaultChanged: boolean; thinkingLevelDefaultChanged: boolean }> {
  if (!explicit.model && !explicit.thinkingLevel) {
    return { modelDefaultChanged: false, thinkingLevelDefaultChanged: false };
  }

  let modelDefaultChanged = false;
  let thinkingLevelDefaultChanged = false;

  if (
    explicit.model
    && effective.model
    && explicit.model.provider === effective.model.provider
    && explicit.model.modelId === effective.model.modelId
  ) {
    settingsManager.setDefaultModelAndProvider(
      effective.model.provider,
      effective.model.modelId,
    );
    modelDefaultChanged = true;
  }

  if (
    explicit.thinkingLevel
    && (effective.supportsThinking || effective.thinkingLevel !== "off")
  ) {
    settingsManager.setDefaultThinkingLevel(effective.thinkingLevel);
    thinkingLevelDefaultChanged = true;
  }

  await settingsManager.flush();
  return { modelDefaultChanged, thinkingLevelDefaultChanged };
}
