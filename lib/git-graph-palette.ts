/**
 * Theme-derived lane palette for the git graph tab.
 *
 * The prototype hardcoded ten colors; in the product the graph must follow
 * the active pi CLI theme. Lane 0 (the first-parent main line) uses the
 * theme's accent color directly; the remaining lanes rotate the accent's hue
 * around the wheel at fixed saturation/lightness so they stay distinguishable
 * on both dark and light backgrounds. Falls back to the prototype's palette
 * when the accent cannot be parsed.
 */

export const FALLBACK_PALETTE = [
  "#5871a3", "#4d9d6e", "#b3702d", "#a34d68", "#7a6bc4",
  "#2e8f8f", "#9d4d4d", "#6e7f3d", "#a3794d", "#4d6e9d",
];

export const LANE_COLOR_COUNT = FALLBACK_PALETTE.length;

function hexToHsl(hex: string): { h: number; s: number; l: number } | null {
  const match = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(hex.trim());
  if (!match) return null;
  let value = match[1];
  if (value.length === 3) {
    value = value.split("").map((c) => c + c).join("");
  }
  const r = parseInt(value.slice(0, 2), 16) / 255;
  const g = parseInt(value.slice(2, 4), 16) / 255;
  const b = parseInt(value.slice(4, 6), 16) / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  if (max === min) return { h: 0, s: 0, l };
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h: number;
  if (max === r) h = ((g - b) / d + (g < b ? 6 : 0)) / 6;
  else if (max === g) h = ((b - r) / d + 2) / 6;
  else h = ((r - g) / d + 4) / 6;
  return { h, s, l };
}

function hslToCss(h: number, s: number, l: number): string {
  // Saturation/lightness are pinned so every lane reads on both themes; only
  // the hue follows the theme accent.
  return `hsl(${Math.round(h * 360)} ${Math.round(s * 100)}% ${Math.round(l * 100)}%)`;
}

export function deriveLanePalette(accent: string): string[] {
  const hsl = hexToHsl(accent);
  if (!hsl) return FALLBACK_PALETTE;
  if (hsl.s < 0.08) {
    // A near-grey accent has no hue to rotate; fall back to a fixed set.
    return FALLBACK_PALETTE;
  }
  const palette: string[] = [hslToCss(hsl.h, Math.max(hsl.s, 0.35), 0.55)];
  // h is normalized to 0..1; rotate the remaining lanes evenly around it.
  const step = 1 / LANE_COLOR_COUNT;
  for (let i = 1; i < LANE_COLOR_COUNT; i++) {
    palette.push(hslToCss((hsl.h + i * step) % 1, 0.45, 0.55));
  }
  return palette;
}
