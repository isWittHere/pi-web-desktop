"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  WALLPAPER_SCRIM_DEFAULT,
  WALLPAPER_URL_KEY,
  WALLPAPER_ENABLED_KEY,
  WALLPAPER_SCRIM_KEY,
  WALLPAPER_INPUT_MODE_KEY,
  WALLPAPER_MESSAGE_MODE_KEY,
  WALLPAPER_PANEL_MODE_KEY,
  WALLPAPER_BLUR_KEY,
  WALLPAPER_BLUR_LEVEL_KEY,
  WALLPAPER_BLUR_INPUT_KEY,
  WALLPAPER_BLUR_MESSAGE_KEY,
  WALLPAPER_BLUR_PANEL_KEY,
  WALLPAPER_TRANSLUCENCY_KEY,
  WALLPAPER_CHANGED_EVENT,
  clampWallpaperScrim,
  fileToWallpaperDataUrl,
  readStoredWallpaperUrl,
} from "@/lib/wallpaper";

/** Per-area effect mode: none (solid) | trans (translucent) | blur. */
export type WallpaperEffectMode = "none" | "trans" | "blur";

function readEnabled(): boolean {
  try {
    return localStorage.getItem(WALLPAPER_ENABLED_KEY) !== "0";
  } catch {
    return false;
  }
}

function readScrim(): number {
  try {
    const v = localStorage.getItem(WALLPAPER_SCRIM_KEY);
    if (v !== null) {
      const n = parseInt(v, 10);
      if (!isNaN(n)) return clampWallpaperScrim(n);
    }
  } catch {}
  return WALLPAPER_SCRIM_DEFAULT;
}

/** Read a per-area mode; absent key falls back to the area's default. */
function readMode(key: string, def: WallpaperEffectMode): WallpaperEffectMode {
  try {
    const v = localStorage.getItem(key);
    if (v === "none" || v === "trans" || v === "blur") return v;
  } catch {}
  return def;
}

/**
 * One-time migration from the legacy effect model (master blur flag +
 * per-area blur flags + translucency flag) to the three per-area modes.
 * Runs before the hook's initial state reads so migrated values land
 * immediately.
 */
function migrateEffectModes() {
  try {
    const hasLegacy =
      localStorage.getItem(WALLPAPER_BLUR_KEY) !== null ||
      localStorage.getItem(WALLPAPER_TRANSLUCENCY_KEY) !== null ||
      [WALLPAPER_BLUR_INPUT_KEY, WALLPAPER_BLUR_MESSAGE_KEY, WALLPAPER_BLUR_PANEL_KEY]
        .some((k) => localStorage.getItem(k) !== null);
    if (!hasLegacy) return;
    const master = localStorage.getItem(WALLPAPER_BLUR_KEY);
    const solid = localStorage.getItem(WALLPAPER_TRANSLUCENCY_KEY) === "0";
    const modeOf = (areaKey: string): WallpaperEffectMode => {
      // A legacy "level" picker may also be present; it was migrated to
      // the per-area flags earlier, so read those flags first.
      const b = localStorage.getItem(areaKey);
      if (b === "1" && master !== "0") return "blur";
      return solid ? "none" : "trans";
    };
    localStorage.setItem(WALLPAPER_INPUT_MODE_KEY, modeOf(WALLPAPER_BLUR_INPUT_KEY));
    localStorage.setItem(WALLPAPER_MESSAGE_MODE_KEY, modeOf(WALLPAPER_BLUR_MESSAGE_KEY));
    localStorage.setItem(WALLPAPER_PANEL_MODE_KEY, modeOf(WALLPAPER_BLUR_PANEL_KEY));
    [WALLPAPER_BLUR_KEY, WALLPAPER_BLUR_LEVEL_KEY, WALLPAPER_BLUR_INPUT_KEY,
     WALLPAPER_BLUR_MESSAGE_KEY, WALLPAPER_BLUR_PANEL_KEY, WALLPAPER_TRANSLUCENCY_KEY]
      .forEach((k) => localStorage.removeItem(k));
  } catch {}
}
migrateEffectModes();

/**
 * Mirror the app/layout.tsx inline bootstrap onto <html>. The wallpaper
 * image itself lives in an <img src> (see WallpaperLayer) — a data URL
 * large enough for a PNG photo would be silently dropped from a CSS
 * property.
 */
function writeDom(enabled: boolean, scrim: number, input: WallpaperEffectMode, message: WallpaperEffectMode, panel: WallpaperEffectMode) {
  const el = document.documentElement;
  if (enabled) el.dataset.wallpaper = "on";
  else delete el.dataset.wallpaper;
  el.style.setProperty("--wallpaper-scrim", `${scrim}%`);
  if (enabled) {
    el.dataset.wallpaperInput = input;
    el.dataset.wallpaperMessage = message;
    el.dataset.wallpaperPanel = panel;
  } else {
    delete el.dataset.wallpaperInput;
    delete el.dataset.wallpaperMessage;
    delete el.dataset.wallpaperPanel;
  }
}

/** Notify the WallpaperLayer that the persisted URL changed. */
function broadcastWallpaperChanged() {
  window.dispatchEvent(new Event(WALLPAPER_CHANGED_EVENT));
}

/**
 * Wallpaper state for the settings panel. The layout.tsx inline script
 * applies the persisted wallpaper before first paint; this hook keeps the
 * DOM in sync for runtime changes, fades new images in once decoded, and
 * broadcasts changes so the WallpaperLayer can refresh its <img src>.
 */
export function useWallpaper() {
  const [enabled, setEnabledState] = useState(readEnabled);
  const [url, setUrlState] = useState(readStoredWallpaperUrl);
  const [scrim, setScrimState] = useState(readScrim);
  const [inputMode, setInputModeState] = useState(() => readMode(WALLPAPER_INPUT_MODE_KEY, "blur"));
  const [messageMode, setMessageModeState] = useState(() => readMode(WALLPAPER_MESSAGE_MODE_KEY, "none"));
  const [panelMode, setPanelModeState] = useState(() => readMode(WALLPAPER_PANEL_MODE_KEY, "none"));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // URL we already ran a fade-in for. Seeded with the stored URL so the
  // mount pass skips re-fading when WallpaperLayer already marked the
  // image ready (opening settings must not blink the wallpaper out).
  // Reset whenever the wallpaper is disabled/cleared so re-enabling
  // triggers a fresh fade-in.
  const lastUrlRef = useRef<string | null>(readStoredWallpaperUrl());

  // Keep <html> attrs/vars in sync with state.
  useEffect(() => {
    writeDom(enabled, scrim, inputMode, messageMode, panelMode);
  }, [enabled, scrim, inputMode, messageMode, panelMode]);

  // Fade a user image in once decoded. Runs on mount and whenever the
  // URL or enabled state changes. Without a user image (or while the
  // wallpaper is off) the ready flag is left alone: the theme
  // wallpaper's <img> (WallpaperLayer) always renders and owns the
  // gate, and a hidden layer's ready value is irrelevant.
  useEffect(() => {
    if (!enabled || !url) return;
    const el = document.documentElement;
    if (lastUrlRef.current === url && el.dataset.wallpaperReady === "1") return;
    lastUrlRef.current = url;
    el.dataset.wallpaperReady = "0";
    const img = new Image();
    img.onload = () => { el.dataset.wallpaperReady = "1"; };
    // Show as-is even if decode fails — the scrim keeps it readable.
    img.onerror = () => { el.dataset.wallpaperReady = "1"; };
    img.src = url;
  }, [enabled, url]);

  /** Pick an image file, downscale it and persist as the wallpaper. */
  const choose = useCallback(async (file: File) => {
    setBusy(true);
    setError(null);
    try {
      const dataUrl = await fileToWallpaperDataUrl(file);
      // Persist first: a quota failure must not half-apply a wallpaper that
      // would silently vanish on the next launch.
      try {
        localStorage.setItem(WALLPAPER_URL_KEY, dataUrl);
        localStorage.setItem(WALLPAPER_ENABLED_KEY, "1");
      } catch {
        setError("Storage quota exceeded — the image is too large to save.");
        return;
      }
      setUrlState(dataUrl);
      setEnabledState(true);
      broadcastWallpaperChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }, []);

  /** Reset to the theme wallpaper: drop the user image, keep enabled
      so the built-in Monet painting for the active theme shows again. */
  const remove = useCallback(() => {
    setUrlState("");
    try { localStorage.removeItem(WALLPAPER_URL_KEY); } catch {}
    broadcastWallpaperChanged();
  }, []);

  /** Toggle the wallpaper on/off without losing the chosen image. */
  const setEnabled = useCallback((v: boolean) => {
    setEnabledState(v);
    try { localStorage.setItem(WALLPAPER_ENABLED_KEY, v ? "1" : "0"); } catch {}
    broadcastWallpaperChanged();
  }, []);

  /** Set the scrim opacity (30–95%). */
  const setScrim = useCallback((v: number) => {
    const clamped = clampWallpaperScrim(v);
    setScrimState(clamped);
    try { localStorage.setItem(WALLPAPER_SCRIM_KEY, String(clamped)); } catch {}
  }, []);

  /** Set an area's effect mode: none (solid) / trans / blur. */
  const setInputMode = useCallback((v: WallpaperEffectMode) => {
    setInputModeState(v);
    try { localStorage.setItem(WALLPAPER_INPUT_MODE_KEY, v); } catch {}
  }, []);
  const setMessageMode = useCallback((v: WallpaperEffectMode) => {
    setMessageModeState(v);
    try { localStorage.setItem(WALLPAPER_MESSAGE_MODE_KEY, v); } catch {}
  }, []);
  const setPanelMode = useCallback((v: WallpaperEffectMode) => {
    setPanelModeState(v);
    try { localStorage.setItem(WALLPAPER_PANEL_MODE_KEY, v); } catch {}
  }, []);

  return { enabled, url, scrim, inputMode, messageMode, panelMode, busy, error, choose, remove, setEnabled, setScrim, setInputMode, setMessageMode, setPanelMode };
}
