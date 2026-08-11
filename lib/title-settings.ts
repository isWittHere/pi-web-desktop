/**
 * Client-side session-title settings.
 *
 * Two localStorage keys drive the title feature:
 * - `pi-title-auto`  ("on" | "off", default "on"): auto-generate a title
 *   after the first user message of a new session.
 * - `pi-title-model` ("provider:modelId"): the configured model used for
 *   title generation. Empty = not configured yet (auto-generation is skipped
 *   until the user picks a model in Settings → Chat).
 */

const TITLE_AUTO_KEY = "pi-title-auto";
const TITLE_MODEL_KEY = "pi-title-model";

export function getTitleAutoEnabled(): boolean {
  try {
    return localStorage.getItem(TITLE_AUTO_KEY) !== "off";
  } catch {
    return true;
  }
}

export function setTitleAutoEnabled(enabled: boolean): void {
  persistSetting(TITLE_AUTO_KEY, enabled ? "on" : "off");
}

/** Stored title model as `{ provider, modelId }`, or null when unset. */
export function getTitleModel(): { provider: string; modelId: string } | null {
  try {
    const stored = localStorage.getItem(TITLE_MODEL_KEY);
    if (!stored) return null;
    const sep = stored.indexOf(":");
    if (sep <= 0) return null;
    const provider = stored.slice(0, sep);
    const modelId = stored.slice(sep + 1);
    if (!provider || !modelId) return null;
    return { provider, modelId };
  } catch {
    return null;
  }
}

export function setTitleModel(provider: string, modelId: string): void {
  persistSetting(TITLE_MODEL_KEY, `${provider}:${modelId}`);
}

export function clearTitleModel(): void {
  persistSetting(TITLE_MODEL_KEY, "");
}

function persistSetting(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
    // Broadcast so other windows/panels pick it up (same pattern as
    // ChatConfig's input-shortcut / notification-duration settings).
    window.dispatchEvent(new StorageEvent("storage", { key, newValue: value }));
  } catch {
    // Ignore storage errors.
  }
}
