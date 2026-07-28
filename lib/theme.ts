/**
 * Theme system for pi-web.
 *
 * Loads pi CLI theme JSON files (from ~/.pi/agent/themes/, .pi/themes/, etc.),
 * resolves `vars` references, and maps the 51 pi CLI color tokens to pi-web's
 * ~23 CSS custom properties.
 *
 * pi CLI theme format:
 *   { name, vars: { key: hex|number, ... }, colors: { token: hex|number|varRef|"", ... } }
 *
 * Color values can be:
 *   - Hex string: "#ff0000"
 *   - 256-color index: 242
 *   - Variable reference: "primary" (resolved from vars)
 *   - Empty string "": terminal default (we derive from palette)
 */

import { readFileSync, readdirSync, existsSync, statSync } from "fs";
import { join, basename, extname } from "path";
import { homedir } from "os";

// ─── Types ───────────────────────────────────────────────────────────────────

export interface PiTheme {
  name: string;
  vars?: Record<string, string | number>;
  colors: Record<string, string | number>;
}

export interface ThemeInfo {
  name: string;
  displayName: string;
  /** File path for a user or project theme. */
  path: string;
}

export interface ResolvedTheme {
  name: string;
  /** CSS variable name → hex value (e.g. "--bg" → "#282828") */
  cssVars: Record<string, string>;
}

// ─── 256-color palette → hex ────────────────────────────────────────────────

// Standard xterm 256-color palette. 0-15: ANSI, 16-231: 6x6x6 cube, 232-255: grayscale.
function ansiToHex(code: number): string {
  // 0-15: basic ANSI colors
  const ansi: Record<number, string> = {
    0: "#000000", 1: "#800000", 2: "#008000", 3: "#808000",
    4: "#000080", 5: "#800080", 6: "#008080", 7: "#c0c0c0",
    8: "#808080", 9: "#ff0000", 10: "#00ff00", 11: "#ffff00",
    12: "#0000ff", 13: "#ff00ff", 14: "#00ffff", 15: "#ffffff",
  };
  if (code in ansi) return ansi[code];

  // 16-231: 6×6×6 RGB cube
  if (code >= 16 && code <= 231) {
    const n = code - 16;
    const r = Math.round((Math.floor(n / 36) % 6) * (255 / 5));
    const g = Math.round((Math.floor(n / 6) % 6) * (255 / 5));
    const b = Math.round((n % 6) * (255 / 5));
    return `#${r.toString(16).padStart(2, "0")}${g.toString(16).padStart(2, "0")}${b.toString(16).padStart(2, "0")}`;
  }

  // 232-255: grayscale ramp
  if (code >= 232 && code <= 255) {
    const v = Math.round(((code - 232) / 23) * 255);
    const h = v.toString(16).padStart(2, "0");
    return `#${h}${h}${h}`;
  }

  return "#000000";
}

// ─── Color resolution ───────────────────────────────────────────────────────

/**
 * Resolve a single color value to a hex string.
 * - Hex string: returned as-is (lowercased)
 * - Number: treated as 256-color index, converted to hex
 * - String matching a var name: resolved from vars
 * - Empty string: returns empty (caller should substitute default)
 */
function resolveColor(
  value: string | number | undefined,
  vars: Record<string, string>,
): string {
  if (value === undefined || value === null) return "";
  if (typeof value === "number") return ansiToHex(value);
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (trimmed === "") return "";
    if (trimmed.startsWith("#")) return trimmed.toLowerCase();
    // Variable reference
    if (vars[trimmed]) return vars[trimmed].toLowerCase();
    // Could be a raw number-as-string: "242"
    const num = Number(trimmed);
    if (!isNaN(num) && trimmed === String(num)) return ansiToHex(num);
    // Unknown reference — return as-is (may be valid hex without #)
    if (/^[0-9a-fA-F]{6}$/.test(trimmed)) return `#${trimmed.toLowerCase()}`;
    return trimmed.toLowerCase();
  }
  return "";
}

/** Resolve all `vars` entries to hex strings. */
function resolveVars(vars: Record<string, string | number> | undefined): Record<string, string> {
  const resolved: Record<string, string> = {};
  if (!vars) return resolved;
  for (const [key, value] of Object.entries(vars)) {
    resolved[key] = resolveColor(value, {});
  }
  return resolved;
}

/** Resolve all `colors` entries, expanding var references. */
function resolveColors(
  colors: Record<string, string | number>,
  vars: Record<string, string>,
): Record<string, string> {
  const resolved: Record<string, string> = {};
  for (const [key, value] of Object.entries(colors)) {
    resolved[key] = resolveColor(value, vars);
  }
  return resolved;
}

// ─── Color manipulation helpers ─────────────────────────────────────────────

function hexToRgb(hex: string): [number, number, number] | null {
  const m = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/.exec(hex);
  if (!m) return null;
  return [parseInt(m[1], 16), parseInt(m[2], 16), parseInt(m[3], 16)];
}

function rgbToHex(r: number, g: number, b: number): string {
  return `#${r.toString(16).padStart(2, "0")}${g.toString(16).padStart(2, "0")}${b.toString(16).padStart(2, "0")}`;
}

/** Lighten a hex color by mixing with white. factor 0 = no change, 1 = white. */
function lighten(hex: string, factor: number): string {
  const rgb = hexToRgb(hex);
  if (!rgb) return hex;
  const [r, g, b] = rgb;
  return rgbToHex(
    Math.round(r + (255 - r) * factor),
    Math.round(g + (255 - g) * factor),
    Math.round(b + (255 - b) * factor),
  );
}

/** Darken a hex color by mixing with black. factor 0 = no change, 1 = black. */
function darken(hex: string, factor: number): string {
  const rgb = hexToRgb(hex);
  if (!rgb) return hex;
  const [r, g, b] = rgb;
  return rgbToHex(
    Math.round(r * (1 - factor)),
    Math.round(g * (1 - factor)),
    Math.round(b * (1 - factor)),
  );
}

/** Mix two hex colors. factor 0 = all a, factor 1 = all b. */
function mix(a: string, b: string, factor: number): string {
  const ra = hexToRgb(a);
  const rb = hexToRgb(b);
  if (!ra || !rb) return a;
  return rgbToHex(
    Math.round(ra[0] + (rb[0] - ra[0]) * factor),
    Math.round(ra[1] + (rb[1] - ra[1]) * factor),
    Math.round(ra[2] + (rb[2] - ra[2]) * factor),
  );
}

/** Calculate relative luminance (0-1). Used to determine dark vs light. */
function relativeLuminance(hex: string): number {
  const rgb = hexToRgb(hex);
  if (!rgb) return 0.5;
  const [rs, gs, bs] = rgb.map((c) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * rs + 0.7152 * gs + 0.0722 * bs;
}

// ─── pi CLI token → CSS variable mapping ────────────────────────────────────

/**
 * Maps resolved pi CLI theme colors + vars to pi-web CSS custom properties.
 *
 * Strategy:
 * 1. Direct 1:1 mappings where pi CLI tokens have clear pi-web equivalents.
 * 2. Derive web-specific colors from the vars palette (bg0-bg4, fg0-fg4, semantic).
 * 3. Fall back to sensible defaults when a pi CLI token is empty/missing.
 */
function mapToCssVars(
  colors: Record<string, string>,
  vars: Record<string, string>,
): Record<string, string> {
  // ── Extract base palette from vars ──
  // Common conventions in pi CLI themes:
  //   bg0 = darkest bg, bg1-bg4 = progressively lighter (dark themes)
  //   fg0 = lightest text, fg1-fg4 = progressively dimmer
  const bg0 = vars.bg0 || "#1a1a1a";
  const bg1 = vars.bg1 || "#242424";
  const bg2 = vars.bg2 || "#2e2e2e";
  const bg3 = vars.bg3 || "#383838";
  const bg4 = vars.bg4 || "#4a4a4a";
  const fg0 = vars.fg0 || "#e8e8e8";
  const fg1 = vars.fg1 || "#d4d4d4";
  const fg3 = vars.fg3 || "#888888";
  const fg4 = vars.fg4 || "#555555";

  // Semantic palette colors
  const red = vars.red || "#dc2626";
  const brightRed = vars.bright_red || "#f87171";
  const green = vars.green || "#16a34a";
  const brightGreen = vars.bright_green || "#3fb950";
  const orange = vars.orange || "#d97706";
  const brightOrange = vars.bright_orange || "#f59e0b";
  const blue = vars.blue || "#2563eb";
  const brightBlue = vars.bright_blue || "#60a5fa";

  // ── Resolve key pi CLI tokens ──
  const accent = colors.accent || orange;
  const text = colors.text || fg0;
  const muted = colors.muted || fg3;
  const dim = colors.dim || fg4;
  const border = colors.border || bg3;
  const borderAccent = colors.borderAccent || accent;
  const borderMuted = colors.borderMuted || bg2;
  const success = colors.success || green;
  const error = colors.error || red;
  const warning = colors.warning || orange;
  const selectedBg = colors.selectedBg || bg2;
  const userMessageBg = colors.userMessageBg || bg1;
  const userMessageText = colors.userMessageText || text;
  const toolSuccessBg = colors.toolSuccessBg || bg1;
  const toolPendingBg = colors.toolPendingBg || bg1;
  const toolErrorBg = colors.toolErrorBg || bg1;

  // Determine if dark theme
  const isDark = relativeLuminance(bg0) < 0.5;

  // ── Build CSS variables ──
  const css: Record<string, string> = {};

  // Core backgrounds
  css["--bg"] = bg0;
  css["--bg-panel"] = bg1;
  css["--bg-secondary"] = bg1;
  css["--bg-card"] = bg1;
  css["--bg-hover"] = bg2;
  // Ensure selected bg is visually distinct from panel bg (use at least bg2 for dark, bg2 equivalent for light)
  css["--bg-selected"] = selectedBg === bg1 ? bg2 : selectedBg;
  css["--bg-card-hover"] = mix(bg1, bg2, 0.5);
  css["--bg-subtle"] = isDark
    ? `rgba(255,255,255,0.035)`
    : `rgba(15,23,42,0.035)`;

  // Borders
  css["--border"] = border;
  css["--border-hover"] = borderAccent;

  // Text
  css["--text"] = text;
  css["--text-muted"] = muted;
  css["--text-dim"] = dim;

  // Accent
  css["--accent"] = accent;
  css["--accent-hover"] = isDark ? lighten(accent, 0.2) : darken(accent, 0.15);
  css["--accent-blue"] = accent; // pi-web uses accent-blue for links/thinking

  // Semantic colors
  css["--accent-red"] = error;
  css["--accent-green"] = success;
  css["--accent-orange"] = warning;

  // Message bubbles
  css["--user-bg"] = userMessageBg;
  css["--assistant-bg"] = bg0; // assistant messages on main bg
  css["--tool-bg"] = toolSuccessBg;
  // Also set tool pending/error backgrounds as CSS comments for reference
  // (these are used via color-mix() in globals.css, which works with base colors)

  // Hatch pattern (used in process tab error states)
  css["--hatch-color"] = isDark
    ? `rgba(${hexToRgb(accent)?.join(",") || "100,193,182"},0.16)`
    : `rgba(${hexToRgb(accent)?.join(",") || "13,148,136"},0.12)`;

  return css;
}

// ─── Theme loading ──────────────────────────────────────────────────────────



/** All required pi CLI color tokens (51 tokens). */
const ALL_COLOR_TOKENS = [
  "accent", "border", "borderAccent", "borderMuted",
  "success", "error", "warning", "muted", "dim", "text", "thinkingText",
  "selectedBg", "userMessageBg", "userMessageText",
  "customMessageBg", "customMessageText", "customMessageLabel",
  "toolPendingBg", "toolSuccessBg", "toolErrorBg", "toolTitle", "toolOutput",
  "mdHeading", "mdLink", "mdLinkUrl", "mdCode", "mdCodeBlock",
  "mdCodeBlockBorder", "mdQuote", "mdQuoteBorder", "mdHr", "mdListBullet",
  "toolDiffAdded", "toolDiffRemoved", "toolDiffContext",
  "syntaxComment", "syntaxKeyword", "syntaxFunction", "syntaxVariable",
  "syntaxString", "syntaxNumber", "syntaxType", "syntaxOperator", "syntaxPunctuation",
  "thinkingOff", "thinkingMinimal", "thinkingLow", "thinkingMedium",
  "thinkingHigh", "thinkingXhigh", "thinkingMax",
  "bashMode",
];

/**
 * Parse a pi CLI theme JSON file.
 * Validates required fields and fills in missing color tokens with empty strings.
 */
function parseThemeFile(path: string): PiTheme | null {
  try {
    const raw = readFileSync(path, "utf-8");
    const json = JSON.parse(raw);

    if (!json.name || typeof json.name !== "string") return null;
    if (!json.colors || typeof json.colors !== "object") return null;

    // Fill missing tokens with empty strings
    const colors: Record<string, string | number> = {};
    for (const token of ALL_COLOR_TOKENS) {
      colors[token] = json.colors[token] ?? "";
    }

    return {
      name: json.name,
      vars: json.vars,
      colors,
    };
  } catch {
    return null;
  }
}

/**
 * Scan a directory for pi CLI theme JSON files.
 * Returns parsed PiTheme objects (non-recursive, only top-level .json files).
 */
function scanThemeDir(dir: string): PiTheme[] {
  const themes: PiTheme[] = [];
  try {
    if (!existsSync(dir)) return themes;
    const entries = readdirSync(dir);
    for (const entry of entries) {
      if (extname(entry) !== ".json") continue;
      const fullPath = join(dir, entry);
      try {
        if (!statSync(fullPath).isFile()) continue;
      } catch {
        continue;
      }
      const theme = parseThemeFile(fullPath);
      if (theme) themes.push(theme);
    }
  } catch {
    // Permission errors, etc.
  }
  return themes;
}

// ─── Public API ─────────────────────────────────────────────────────────────

/** List all available themes (global + project). */
export function listThemes(projectCwd?: string): ThemeInfo[] {
  const result: ThemeInfo[] = [];
  const seen = new Set<string>();

  // Global themes: ~/.pi/agent/themes/
  const globalDir = join(homedir(), ".pi", "agent", "themes");
  for (const theme of scanThemeDir(globalDir)) {
    if (seen.has(theme.name)) continue;
    seen.add(theme.name);
    result.push({
      name: theme.name,
      displayName: themeNameToDisplay(theme.name),
      path: join(globalDir, `${theme.name}.json`),
    });
  }

  // Project themes: .pi/themes/ (relative to cwd)
  if (projectCwd) {
    const projectDir = join(projectCwd, ".pi", "themes");
    for (const theme of scanThemeDir(projectDir)) {
      if (seen.has(theme.name)) continue;
      seen.add(theme.name);
      result.push({
        name: theme.name,
        displayName: themeNameToDisplay(theme.name),
        path: join(projectDir, `${theme.name}.json`),
      });
    }
  }

  return result;
}

/** Convert a kebab-case theme name to a display-friendly title. */
function themeNameToDisplay(name: string): string {
  return name
    .split(/[-_]/)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

/**
 * Load and fully resolve a theme by name.
 *
 * Resolution steps:
 * 1. Scan global and project theme directories to find the file.
 * 2. Parse the JSON, resolve vars, resolve colors, and map to CSS variables.
 */
export function resolveTheme(name: string, projectCwd?: string): ResolvedTheme | null {
  // Search for the theme file
  let theme: PiTheme | null = null;

  // Try global dir
  const globalDir = join(homedir(), ".pi", "agent", "themes");
  const globalPath = join(globalDir, `${name}.json`);
  if (existsSync(globalPath)) {
    theme = parseThemeFile(globalPath);
  }

  // Try project dir
  if (!theme && projectCwd) {
    const projectDir = join(projectCwd, ".pi", "themes");
    const projectPath = join(projectDir, `${name}.json`);
    if (existsSync(projectPath)) {
      theme = parseThemeFile(projectPath);
    }
  }

  // Try direct path (from settings or CLI)
  if (!theme && existsSync(name)) {
    theme = parseThemeFile(name);
  }

  if (!theme) return null;

  // Resolve
  const vars = resolveVars(theme.vars);
  const colors = resolveColors(theme.colors, vars);
  const cssVars = mapToCssVars(colors, vars);
  return {
    name: theme.name,
    cssVars,
  };
}
