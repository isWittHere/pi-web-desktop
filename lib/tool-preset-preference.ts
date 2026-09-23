import { CONFIGURED_TOOL_PRESET, isAllToolPreset, type AllToolPreset } from "./tool-presets";

const STORAGE_KEY = "pi-tool-preset";

interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

function getBrowserStorage(): StorageLike | null {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

export function getPreferredToolPreset(
  storage: StorageLike | null = getBrowserStorage(),
): AllToolPreset {
  if (!storage) return CONFIGURED_TOOL_PRESET;
  try {
    const value = storage.getItem(STORAGE_KEY);
    return isAllToolPreset(value) ? value : CONFIGURED_TOOL_PRESET;
  } catch {
    return CONFIGURED_TOOL_PRESET;
  }
}

export function setPreferredToolPreset(
  preset: AllToolPreset,
  storage: StorageLike | null = getBrowserStorage(),
): void {
  if (!storage) return;
  try {
    storage.setItem(STORAGE_KEY, preset);
  } catch {
    // Browser storage is best-effort.
  }
}
