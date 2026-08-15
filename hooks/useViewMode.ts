"use client";

import { useCallback, useEffect, useState } from "react";

/**
 * View mode: classic (single active workspace + title-bar selector) vs tabs
 * (browser-style workspace tabs). Both modes share the same underlying
 * workspace state machine; the mode only changes which UI hosts render.
 *
 * Stored in localStorage under `pi-web:view-mode` (default "classic"). The
 * mode is read after mount — it only affects client-side UI composition, so
 * no pre-hydration inline script is needed.
 */

export type ViewMode = "classic" | "tabs";

const VIEW_MODE_KEY = "pi-web:view-mode";

function readViewMode(): ViewMode {
  if (typeof window === "undefined") return "classic";
  try {
    return window.localStorage.getItem(VIEW_MODE_KEY) === "tabs" ? "tabs" : "classic";
  } catch {
    return "classic";
  }
}

export function useViewMode() {
  // SSR/hydration: start at the default so the server render matches; the
  // stored mode is applied once the client is mounted.
  const [viewMode, setViewModeState] = useState<ViewMode>("classic");
  useEffect(() => {
    setViewModeState(readViewMode());
  }, []);

  const setViewMode = useCallback((mode: ViewMode) => {
    setViewModeState(mode);
    try {
      window.localStorage.setItem(VIEW_MODE_KEY, mode);
    } catch {
      // storage unavailable — mode stays for this session only
    }
  }, []);

  return { viewMode, setViewMode };
}
