"use client";

import { useCallback, useSyncExternalStore } from "react";

/**
 * View mode: classic (single active workspace + title-bar selector) vs tabs
 * (browser-style workspace tabs). Both modes share the same underlying
 * workspace state machine; the mode only changes which UI hosts render.
 *
 * Module-level store + useSyncExternalStore (like useProjectContext), so the
 * shell and the settings panel always agree on the current mode and a change
 * in the settings dialog re-renders every consumer. Persisted in localStorage
 * under `pi-web:view-mode` (default "classic").
 */

export type ViewMode = "classic" | "tabs";

const VIEW_MODE_KEY = "pi-web:view-mode";

const listeners = new Set<() => void>();
let cachedMode: ViewMode | null = null;

function readStoredMode(): ViewMode {
  if (typeof window === "undefined") return "classic";
  try {
    return window.localStorage.getItem(VIEW_MODE_KEY) === "tabs" ? "tabs" : "classic";
  } catch {
    return "classic";
  }
}

function getMode(): ViewMode {
  if (cachedMode === null) cachedMode = readStoredMode();
  return cachedMode;
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function notify() {
  for (const listener of listeners) listener();
}

export function useViewMode() {
  const viewMode = useSyncExternalStore(subscribe, getMode, () => "classic");

  const setViewMode = useCallback((mode: ViewMode) => {
    cachedMode = mode;
    try {
      window.localStorage.setItem(VIEW_MODE_KEY, mode);
    } catch {
      // storage unavailable — mode stays for this session only
    }
    notify();
  }, []);

  return { viewMode, setViewMode };
}
