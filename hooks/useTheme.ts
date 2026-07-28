"use client";

import { useCallback, useEffect, useSyncExternalStore, useRef } from "react";
import type { ResolvedTheme } from "@/lib/theme";

export type ThemeMode = "light" | "dark";
export type ThemeName = string;

const listeners = new Set<() => void>();

function subscribe(cb: () => void): () => void {
  listeners.add(cb);
  return () => {
    listeners.delete(cb);
  };
}

// ─── Snapshot helpers ───────────────────────────────────────────────────────

function getModeSnapshot(): ThemeMode {
  if (typeof document === "undefined") return "light";
  // Check data attribute first (set by inline script), then localStorage
  const dataMode = document.documentElement.dataset.themeMode as ThemeMode | undefined;
  if (dataMode === "dark" || dataMode === "light") return dataMode;
  try {
    const stored = localStorage.getItem("pi-theme-mode");
    if (stored === "dark" || stored === "light") return stored;
  } catch {}
  return "light";
}

function normalizeThemeName(theme: string | undefined | null): ThemeName {
  // `pi-theme` used to store the mode. Do not treat legacy values as theme names.
  return theme === "dark" || theme === "light" ? "" : theme || "";
}

function getThemeSnapshot(): ThemeName {
  if (typeof document === "undefined") return "";
  const dataTheme = normalizeThemeName(document.documentElement.dataset.theme);
  if (dataTheme) return dataTheme;
  try {
    return normalizeThemeName(localStorage.getItem("pi-theme"));
  } catch {
    return "";
  }
}

function getServerSnapshot(): ThemeMode {
  return "light";
}

// ─── CSS variable management ────────────────────────────────────────────────

const THEME_CSS_VARS = [
  "--bg", "--bg-panel", "--bg-secondary", "--bg-card", "--bg-hover",
  "--bg-selected", "--bg-card-hover", "--bg-subtle",
  "--border", "--border-hover",
  "--text", "--text-muted", "--text-dim",
  "--accent", "--accent-hover", "--accent-blue",
  "--accent-red", "--accent-green", "--accent-orange",
  "--user-bg", "--assistant-bg", "--tool-bg",
  "--hatch-color",
];

function applyThemeCssVars(cssVars: Record<string, string>) {
  const el = document.documentElement;
  for (const varName of THEME_CSS_VARS) {
    if (cssVars[varName]) {
      el.style.setProperty(varName, cssVars[varName]);
    } else {
      el.style.removeProperty(varName);
    }
  }
}

function clearThemeCssVars() {
  const el = document.documentElement;
  for (const varName of THEME_CSS_VARS) {
    el.style.removeProperty(varName);
  }
}

// ─── Core apply logic ───────────────────────────────────────────────────────

/**
 * Apply mode + theme to the DOM.
 *
 * - mode="dark" + theme="" → dark class + globals.css defaults
 * - mode="dark" + theme="gruvbox-dark" → dark class + custom CSS vars
 * - mode="light" + theme="" → no dark class + globals.css defaults
 * - mode="light" + theme="gruvbox-light" → no dark class + custom CSS vars
 */
async function applyModeAndTheme(mode: ThemeMode, theme: ThemeName): Promise<void> {
  const el = document.documentElement;

  // Set mode attributes
  el.dataset.themeMode = mode;
  if (mode === "dark") {
    el.classList.add("dark");
  } else {
    el.classList.remove("dark");
  }

  // Empty theme = use built-in defaults (globals.css)
  if (!theme) {
    delete el.dataset.theme;
    clearThemeCssVars();
    return;
  }

  // Named theme — fetch resolved CSS vars from API. The mode remains an
  // independent user preference and is never inferred from the theme.
  try {
    el.dataset.theme = theme;
    const resp = await fetch(`/api/themes/${encodeURIComponent(theme)}`);
    if (!resp.ok) {
      console.warn(`Theme "${theme}" not found, using defaults`);
      clearThemeCssVars();
      return;
    }
    const resolved: ResolvedTheme = await resp.json();
    applyThemeCssVars(resolved.cssVars);
  } catch (err) {
    console.error(`Failed to load theme "${theme}":`, err);
    clearThemeCssVars();
  }
}

// ─── Hook ───────────────────────────────────────────────────────────────────

type ToggleOrigin = { x: number; y: number };

export function useTheme() {
  const mode = useSyncExternalStore(subscribe, getModeSnapshot, getServerSnapshot);
  const themeName = useSyncExternalStore(subscribe, getThemeSnapshot, () => "");
  const isDark = typeof document !== "undefined"
    ? document.documentElement.classList.contains("dark")
    : mode === "dark";

  const applyingRef = useRef<string | null>(null);

  // On mount, if inline script set a pending theme/mode, apply it
  useEffect(() => {
    const el = document.documentElement;
    const dataTheme = el.dataset.theme;
    const dataMode = el.dataset.themeMode as ThemeMode | undefined;

    const effectiveMode: ThemeMode = dataMode === "dark" || dataMode === "light" ? dataMode : mode;
    const effectiveTheme = normalizeThemeName(dataTheme) || themeName;

    const key = `${effectiveMode}:${effectiveTheme}`;
    if (applyingRef.current === key) return;
    applyingRef.current = key;
    applyModeAndTheme(effectiveMode, effectiveTheme).finally(() => {
      applyingRef.current = null;
      try { localStorage.setItem("pi-theme-mode", effectiveMode); } catch {}
      try { localStorage.setItem("pi-theme", effectiveTheme); } catch {}
      listeners.forEach((cb) => cb());
    });
  }, [mode, themeName]);

  /** Set the light/dark mode without changing the selected theme. */
  const setMode = useCallback((nextMode: ThemeMode) => {
    const el = document.documentElement;
    el.dataset.themeMode = nextMode;
    el.classList.toggle("dark", nextMode === "dark");

    try {
      localStorage.setItem("pi-theme-mode", nextMode);
    } catch {}
    listeners.forEach((cb) => cb());
  }, []);

  /** Set a named theme without inferring or changing the selected mode. */
  const setTheme = useCallback(async (nextTheme: ThemeName) => {
    const nextMode = getModeSnapshot();
    const key = `${nextMode}:${nextTheme}`;
    if (applyingRef.current === key) return;
    applyingRef.current = key;

    try {
      await applyModeAndTheme(nextMode, nextTheme);
    } finally {
      applyingRef.current = null;
    }

    try {
      localStorage.setItem("pi-theme", nextTheme);
    } catch {}
    listeners.forEach((cb) => cb());
  }, []);

  const toggleTheme = useCallback((origin?: ToggleOrigin) => {
    const currentMode = getModeSnapshot();
    const nextMode: ThemeMode = currentMode === "dark" ? "light" : "dark";

    const apply = () => {
      setMode(nextMode);
    };

    const reduceMotion = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    const supportsVT = typeof document.startViewTransition === "function";

    if (!supportsVT || reduceMotion) {
      apply();
      return;
    }

    const x = origin?.x ?? window.innerWidth / 2;
    const y = origin?.y ?? window.innerHeight / 2;
    const endRadius = Math.hypot(
      Math.max(x, window.innerWidth - x),
      Math.max(y, window.innerHeight - y),
    );

    const transition = document.startViewTransition(() => { apply(); });
    transition.ready
      .then(() => {
        document.documentElement.animate(
          {
            clipPath: [
              `circle(0px at ${x}px ${y}px)`,
              `circle(${endRadius}px at ${x}px ${y}px)`,
            ],
          },
          {
            duration: 450,
            easing: "cubic-bezier(0.22, 0.61, 0.36, 1)",
            pseudoElement: "::view-transition-new(root)",
          },
        );
      })
      .catch(() => {});
  }, [setMode]);

  return { mode, themeName, setMode, setTheme, toggleTheme, isDark };
}
