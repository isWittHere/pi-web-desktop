"use client";

import { useCallback, useEffect, useState, useRef, useSyncExternalStore } from "react";
import type { ResolvedTheme } from "@/lib/theme";

export type ThemeMode = "light" | "dark" | "system";
/** The actual rendered mode (never "system"). */
export type ResolvedMode = "light" | "dark";

const listeners = new Set<() => void>();

function subscribe(cb: () => void): () => void {
  listeners.add(cb);
  return () => { listeners.delete(cb); };
}

function notify() { listeners.forEach((cb) => cb()); }

// ─── localStorage keys ──────────────────────────────────────────────────────

const KEY_MODE = "pi-theme-mode";
const KEY_THEME = "pi-theme";

/** Migration: extract base name from old per-mode keys (e.g. "gruvbox-dark" → "gruvbox"). */
function migrateOldTheme(): string | null {
  try {
    const oldDark = localStorage.getItem("pi-theme-dark");
    const oldLight = localStorage.getItem("pi-theme-light");

    for (const old of [oldDark, oldLight]) {
      if (!old || old === "dark" || old === "light") continue;
      const base = old.replace(/-dark$/i, "").replace(/-light$/i, "");
      if (base && base !== old) {
        localStorage.setItem(KEY_THEME, base);
        localStorage.removeItem("pi-theme-dark");
        localStorage.removeItem("pi-theme-light");
        return base;
      }
    }
    const v = oldDark || oldLight;
    if (v && v !== "dark" && v !== "light") {
      localStorage.setItem(KEY_THEME, v);
      localStorage.removeItem("pi-theme-dark");
      localStorage.removeItem("pi-theme-light");
      return v;
    }
  } catch {}
  return null;
}

function readMode(): ThemeMode {
  try {
    const v = localStorage.getItem(KEY_MODE);
    if (v === "dark" || v === "light" || v === "system") return v;
  } catch {}
  return "dark";
}

function readTheme(): string {
  try {
    if (localStorage.getItem(KEY_THEME) === null) {
      const migrated = migrateOldTheme();
      if (migrated) return migrated;
    }
    const v = localStorage.getItem(KEY_THEME);
    if (v) return v;
  } catch {}
  return "";
}

// ─── System preference ──────────────────────────────────────────────────────

function getSystemPrefersDark(): boolean {
  if (typeof window === "undefined") return true;
  return window.matchMedia("(prefers-color-scheme: dark)").matches;
}

function resolveEffectiveMode(stored: ThemeMode): ResolvedMode {
  if (stored === "system") return getSystemPrefersDark() ? "dark" : "light";
  return stored;
}

/** Subscribe to OS-level color scheme changes. */
function subscribeSystemColorScheme(cb: () => void): () => void {
  if (typeof window === "undefined") return () => {};
  const mq = window.matchMedia("(prefers-color-scheme: dark)");
  mq.addEventListener("change", cb);
  return () => mq.removeEventListener("change", cb);
}

// ─── Snapshots ──────────────────────────────────────────────────────────────

function getModeSnapshot(): ThemeMode {
  if (typeof document === "undefined") return "dark";
  const dm = document.documentElement.dataset.themeMode as ThemeMode | undefined;
  if (dm === "dark" || dm === "light" || dm === "system") return dm;
  return readMode();
}

function getThemeSnapshot(): string {
  if (typeof document === "undefined") return "";
  const dt = document.documentElement.dataset.theme;
  if (dt) return dt;
  return readTheme();
}

function getServerSnapshot(): ThemeMode { return "dark"; }

// ─── CSS vars ───────────────────────────────────────────────────────────────

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

function applyCssVars(vars: Record<string, string>) {
  const el = document.documentElement;
  for (const k of THEME_CSS_VARS) {
    if (vars[k]) el.style.setProperty(k, vars[k]);
    else el.style.removeProperty(k);
  }
}

function clearCssVars() {
  const el = document.documentElement;
  for (const k of THEME_CSS_VARS) el.style.removeProperty(k);
}

// ─── Fetch + apply ──────────────────────────────────────────────────────────

/** Cache keyed by `name::mode`. */
const themeCache = new Map<string, ResolvedTheme>();

async function fetchTheme(name: string, mode: ResolvedMode): Promise<ResolvedTheme | null> {
  const cacheKey = `${name}::${mode}`;
  if (themeCache.has(cacheKey)) return themeCache.get(cacheKey)!;
  try {
    const resp = await fetch(`/api/themes/${encodeURIComponent(name)}?mode=${mode}`);
    if (!resp.ok) return null;
    const data: ResolvedTheme = await resp.json();
    themeCache.set(cacheKey, data);
    return data;
  } catch {
    return null;
  }
}

async function applyModeAndTheme(
  resolvedMode: ResolvedMode,
  themeName: string,
): Promise<void> {
  const el = document.documentElement;

  // Apply dark class based on resolved mode
  if (resolvedMode === "dark") el.classList.add("dark");
  else el.classList.remove("dark");

  // No custom theme → use globals.css built-in
  if (!themeName) {
    delete el.dataset.theme;
    clearCssVars();
    return;
  }

  // Named theme → load appropriate variant
  el.dataset.theme = themeName;
  const resolved = await fetchTheme(themeName, resolvedMode);
  if (resolved) {
    applyCssVars(resolved.cssVars);
  } else {
    console.warn(`Theme "${themeName}" variant "${resolvedMode}" not found, using defaults`);
    clearCssVars();
  }
}

// ─── Hook ───────────────────────────────────────────────────────────────────

type ToggleOrigin = { x: number; y: number };

export function useTheme() {
  const mode = useSyncExternalStore(subscribe, getModeSnapshot, getServerSnapshot);
  const storedThemeName = useSyncExternalStore(subscribe, getThemeSnapshot, () => "");

  // Resolved mode — must trigger re-renders when it changes
  const [resolvedMode, setResolvedMode] = useState<ResolvedMode>(() => {
    if (typeof document !== "undefined") {
      const dm = document.documentElement.dataset.themeResolvedMode as ResolvedMode | undefined;
      if (dm === "dark" || dm === "light") return dm;
    }
    return resolveEffectiveMode(getModeSnapshot());
  });

  const isDark = resolvedMode === "dark";

  const applyingRef = useRef(false);

  // Sync document attributes + resolvedMode state
  const syncDOM = useCallback((rmode: ResolvedMode, m: ThemeMode, t: string) => {
    const el = document.documentElement;
    el.dataset.themeMode = m;
    el.dataset.themeResolvedMode = rmode;
    if (rmode === "dark") el.classList.add("dark");
    else el.classList.remove("dark");
    if (t) el.dataset.theme = t;
    else delete el.dataset.theme;
    setResolvedMode(rmode);
  }, []);

  // On mount: if inline script set pending attrs, apply them
  useEffect(() => {
    const el = document.documentElement;
    const dm = el.dataset.themeMode as ThemeMode | undefined;
    const dt = el.dataset.theme;
    const m = dm === "dark" || dm === "light" || dm === "system" ? dm : mode;
    const t = dt || storedThemeName;

    if (applyingRef.current) return;
    applyingRef.current = true;

    const rmode = resolveEffectiveMode(m);
    syncDOM(rmode, m, t);

    applyModeAndTheme(rmode, t).finally(() => {
      applyingRef.current = false;
      try { localStorage.setItem(KEY_MODE, m); } catch {}
      try { localStorage.setItem(KEY_THEME, t); } catch {}
      notify();
    });
  }, []);

  // Subscribe to OS color scheme changes
  useEffect(() => {
    return subscribeSystemColorScheme(() => {
      if (getModeSnapshot() === "system") {
        const newResolved = getSystemPrefersDark() ? "dark" : "light";
        const tn = readTheme();
        syncDOM(newResolved, "system", tn);
        applyModeAndTheme(newResolved, tn);
        notify();
      }
    });
  }, [syncDOM]);

  /** Pick a theme set. Does NOT change mode. */
  const setTheme = useCallback(async (name: string) => {
    if (applyingRef.current) return;
    applyingRef.current = true;

    try {
      await applyModeAndTheme(resolvedMode, name);
      try { localStorage.setItem(KEY_THEME, name); } catch {}
      const m = getModeSnapshot();
      syncDOM(resolvedMode, m, name);
      notify();
    } finally {
      applyingRef.current = false;
    }
  }, [resolvedMode, syncDOM]);

  /** Set the mode preference (light / dark / system). */
  const setModeAction = useCallback(async (nextMode: ThemeMode) => {
    if (applyingRef.current) return;
    applyingRef.current = true;

    const rmode = resolveEffectiveMode(nextMode);
    const tn = readTheme();

    try {
      await applyModeAndTheme(rmode, tn);
      try { localStorage.setItem(KEY_MODE, nextMode); } catch {}
      syncDOM(rmode, nextMode, tn);
      notify();
    } finally {
      applyingRef.current = false;
    }
  }, [syncDOM]);

  /** Toggle between light / dark (explicit modes). If currently "system", switch to the opposite of resolved. */
  const toggleTheme = useCallback((origin?: ToggleOrigin) => {
    const curMode = getModeSnapshot();
    const curResolved = resolvedMode;
    const nextMode: ThemeMode = curMode === "system"
      ? (curResolved === "dark" ? "light" : "dark")
      : (curMode === "dark" ? "light" : "dark");

    const apply = () => { setModeAction(nextMode); };

    const reduceMotion = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    const supportsVT = typeof document.startViewTransition === "function";

    if (!supportsVT || reduceMotion) { apply(); return; }

    const x = origin?.x ?? window.innerWidth / 2;
    const y = origin?.y ?? window.innerHeight / 2;
    const endRadius = Math.hypot(
      Math.max(x, window.innerWidth - x),
      Math.max(y, window.innerHeight - y),
    );

    const transition = document.startViewTransition(() => { apply(); });
    transition.ready.then(() => {
      document.documentElement.animate({
        clipPath: [
          `circle(0px at ${x}px ${y}px)`,
          `circle(${endRadius}px at ${x}px ${y}px)`,
        ],
      }, {
        duration: 450,
        easing: "cubic-bezier(0.22, 0.61, 0.36, 1)",
        pseudoElement: "::view-transition-new(root)",
      });
    }).catch(() => {});
  }, [resolvedMode, setModeAction]);

  return {
    /** Stored preference: "light" | "dark" | "system" */
    mode,
    /** Actual rendered mode (never "system"). Triggers re-renders. */
    resolvedMode,
    /** Selected theme set name ("" for built-in default). */
    themeName: storedThemeName,
    /** Set mode preference (light / dark / system). */
    setMode: setModeAction,
    /** Set theme set without changing mode. */
    setTheme,
    /** Quick toggle between light/dark (with View Transition). */
    toggleTheme,
    /** Is the current effective mode dark? */
    isDark,
  };
}
