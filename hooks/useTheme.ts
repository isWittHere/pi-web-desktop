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
const KEY_BORDER_DEPTH = "pi-border-depth";

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

function readBorderDepth(): number {
  try {
    const v = localStorage.getItem(KEY_BORDER_DEPTH);
    if (v !== null) {
      const n = parseInt(v, 10);
      if (!isNaN(n) && n >= 0 && n <= 100) return n;
    }
  } catch {}
  return 50;
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
  "--git-status-added", "--git-status-modified", "--git-status-deleted",
  "--git-status-added-bg", "--git-status-modified-bg", "--git-status-deleted-bg",
  "--user-bg", "--assistant-bg", "--tool-bg",
  "--hatch-color",
];

/**
 * Preserve the raw theme border colors before any depth adjustment.
 * These stay untouched; `applyBorderDepth` reads them to derive
 * the active `--border` / `--border-hover` values.
 */
const BORDER_ORIG_VARS = ["--border-orig", "--border-hover-orig"] as const;

function applyCssVars(vars: Record<string, string>) {
  const el = document.documentElement;
  for (const k of THEME_CSS_VARS) {
    if (vars[k]) el.style.setProperty(k, vars[k]);
    else el.style.removeProperty(k);
  }
  // snapshot original border colors for depth slider
  if (vars["--border"]) el.style.setProperty("--border-orig", vars["--border"]);
  else el.style.removeProperty("--border-orig");
  if (vars["--border-hover"]) el.style.setProperty("--border-hover-orig", vars["--border-hover"]);
  else el.style.removeProperty("--border-hover-orig");
}

function clearCssVars() {
  const el = document.documentElement;
  for (const k of THEME_CSS_VARS) el.style.removeProperty(k);
  for (const k of BORDER_ORIG_VARS) el.style.removeProperty(k);
}

// ─── Border depth adjustment ────────────────────────────────────────────────

/**
 * Derive active `--border` / `--border-hover` from the original theme
 * border colors + the user-controlled depth slider.
 *
 * Depth  0 → border = background  (invisible)
 * Depth 50 → border = theme value (passthrough)
 * Depth 100 → border = text color (maximum contrast)
 */
/** Ensure --border-orig / --border-hover-orig are populated.
 *  For pi CLI JSON themes they are set by applyCssVars().
 *  For the built-in Default theme (globals.css :root / html.dark)
 *  we read the computed --border / --border-hover from the CSS
 *  cascade and cache them as -orig, so the depth slider always
 *  has a real color to blend from. */
function ensureBorderOrig() {
  const el = document.documentElement;
  let orig = el.style.getPropertyValue("--border-orig").trim();
  let hover = el.style.getPropertyValue("--border-hover-orig").trim();

  if (!orig || !hover) {
    const cs = getComputedStyle(el);
    if (!orig) {
      orig = cs.getPropertyValue("--border").trim();
      if (orig) el.style.setProperty("--border-orig", orig);
    }
    if (!hover) {
      hover = cs.getPropertyValue("--border-hover").trim();
      if (hover) el.style.setProperty("--border-hover-orig", hover);
    }
  }
}

function applyBorderDepth(depth: number) {
  const el = document.documentElement;

  // Make sure we have source colors even for the Default (CSS-only) theme.
  ensureBorderOrig();

  if (depth === 50) {
    // Use originals directly — no color-mix overhead
    const orig = el.style.getPropertyValue("--border-orig").trim();
    const hoverOrig = el.style.getPropertyValue("--border-hover-orig").trim();
    if (orig) el.style.setProperty("--border", orig);
    else el.style.removeProperty("--border");
    if (hoverOrig) el.style.setProperty("--border-hover", hoverOrig);
    else el.style.removeProperty("--border-hover");
    return;
  }

  const n = depth / 100;

  const expr = (origProp: string) => {
    if (n <= 0.5) {
      // 0→50: blend from bg (invisible) to theme original
      const origPct = Math.round(n * 2 * 100); // 0% → 100%
      return `color-mix(in srgb, var(${origProp}) ${origPct}%, var(--bg) ${100 - origPct}%)`;
    } else {
      // 50→100: blend from theme original to text (max contrast)
      const textPct = Math.round((n - 0.5) * 2 * 100); // 0% → 100%
      return `color-mix(in srgb, var(${origProp}) ${100 - textPct}%, var(--text) ${textPct}%)`;
    }
  };

  el.style.setProperty("--border", expr("--border-orig"));
  el.style.setProperty("--border-hover", expr("--border-hover-orig"));
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

  if (resolvedMode === "dark") el.classList.add("dark");
  else el.classList.remove("dark");

  if (!themeName) {
    delete el.dataset.theme;
    clearCssVars();
    return;
  }

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

  // Border depth slider (0-100, default 50 = theme unchanged)
  const [borderDepth, setBorderDepthState] = useState<number>(() => readBorderDepth());

  const setBorderDepth = useCallback((depth: number) => {
    const clamped = Math.max(0, Math.min(100, Math.round(depth)));
    setBorderDepthState(clamped);
    try { localStorage.setItem(KEY_BORDER_DEPTH, String(clamped)); } catch {}
    applyBorderDepth(clamped);
  }, []);

  const isDark = resolvedMode === "dark";

  const applyingRef = useRef(false);

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

  // On mount: apply theme + border depth from inline-script pre-set attributes.
  // These snapshots intentionally seed a one-time hydration reconciliation.
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
      applyBorderDepth(readBorderDepth());
      notify();
    });
    // The inline bootstrap state must be reconciled once before subscriptions update.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // OS color scheme changes
  useEffect(() => {
    return subscribeSystemColorScheme(() => {
      if (getModeSnapshot() === "system") {
        const newResolved = getSystemPrefersDark() ? "dark" : "light";
        const tn = readTheme();
        syncDOM(newResolved, "system", tn);
        applyModeAndTheme(newResolved, tn);
        applyBorderDepth(readBorderDepth());
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
      applyBorderDepth(readBorderDepth());
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
      applyBorderDepth(readBorderDepth());
      notify();
    } finally {
      applyingRef.current = false;
    }
  }, [syncDOM]);

  /** Toggle between light / dark (explicit modes). */
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
    mode,
    resolvedMode,
    themeName: storedThemeName,
    setMode: setModeAction,
    setTheme,
    toggleTheme,
    isDark,
    /** Border visibility depth (0 = invisible, 50 = theme default, 100 = max contrast). */
    borderDepth,
    /** Set border depth (0-100). */
    setBorderDepth,
  };
}
