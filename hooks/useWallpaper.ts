"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  WALLPAPER_SCRIM_DEFAULT,
  WALLPAPER_URL_KEY,
  WALLPAPER_ENABLED_KEY,
  WALLPAPER_SCRIM_KEY,
  WALLPAPER_CHANGED_EVENT,
  clampWallpaperScrim,
  fileToWallpaperDataUrl,
  readStoredWallpaperUrl,
} from "@/lib/wallpaper";

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

/**
 * Mirror the app/layout.tsx inline bootstrap onto <html>. The wallpaper
 * image itself lives in an <img src> (see ChatWindow) — a data URL large
 * enough for a PNG photo would be silently dropped from a CSS property.
 */
function writeDom(enabled: boolean, scrim: number) {
  const el = document.documentElement;
  if (enabled) el.dataset.wallpaper = "on";
  else delete el.dataset.wallpaper;
  el.style.setProperty("--wallpaper-scrim", `${scrim}%`);
}

/** Notify ChatWindow's <img> layer that the persisted URL changed. */
function broadcastWallpaperChanged() {
  window.dispatchEvent(new Event(WALLPAPER_CHANGED_EVENT));
}

/**
 * Wallpaper state for the settings panel. The layout.tsx inline script
 * applies the persisted wallpaper before first paint; this hook keeps the
 * DOM in sync for runtime changes, fades new images in once decoded, and
 * broadcasts changes so ChatWindow can refresh its <img src>.
 */
export function useWallpaper() {
  const [enabled, setEnabledState] = useState(readEnabled);
  const [url, setUrlState] = useState(readStoredWallpaperUrl);
  const [scrim, setScrimState] = useState(readScrim);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // URL we already ran a fade-in for. Reset whenever the wallpaper is
  // disabled/cleared so re-enabling triggers a fresh fade-in.
  const lastUrlRef = useRef<string | null>(null);

  // Keep <html> attrs/vars in sync with state.
  useEffect(() => {
    writeDom(enabled, scrim);
  }, [enabled, scrim]);

  // Fade the image in once decoded. Runs on mount (the inline script no
  // longer pre-marks ready) and whenever the URL or enabled state changes.
  useEffect(() => {
    const el = document.documentElement;
    if (!enabled || !url) {
      lastUrlRef.current = null;
      el.dataset.wallpaperReady = "0";
      return;
    }
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

  /** Clear the wallpaper entirely. */
  const remove = useCallback(() => {
    setUrlState("");
    setEnabledState(false);
    try { localStorage.removeItem(WALLPAPER_URL_KEY); } catch {}
    try { localStorage.setItem(WALLPAPER_ENABLED_KEY, "0"); } catch {}
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

  return { enabled, url, scrim, busy, error, choose, remove, setEnabled, setScrim };
}
