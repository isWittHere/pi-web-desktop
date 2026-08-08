/**
 * Built-in theme registry.
 *
 * These pi CLI theme JSON files ship with the app so they are available
 * out-of-the-box without the user copying them into `~/.pi/agent/themes/`.
 * They are bundled at build time via `resolveJsonModule` (see tsconfig.json).
 *
 * User themes placed in `~/.pi/agent/themes/` or `<cwd>/.pi/themes/` take
 * precedence over a built-in with the same base name (handled in lib/theme.ts).
 */
import type { PiTheme } from "@/lib/theme";

import gruvboxDark from "./gruvbox-dark.json";
import gruvboxLight from "./gruvbox-light.json";
import mikuAquaDark from "./miku-aqua-dark.json";
import mikuAquaLight from "./miku-aqua-light.json";
import orbitalRoseDark from "./orbital-rose-dark.json";
import orbitalRoseLight from "./orbital-rose-light.json";
import scarletTetherDark from "./scarlet-tether-dark.json";
import scarletTetherLight from "./scarlet-tether-light.json";
import solarizedDark from "./solarized-dark.json";
import solarizedLight from "./solarized-light.json";

/** A built-in theme set, pairing a dark and/or light variant by base name. */
export interface BuiltinThemeSet {
  /** Base name, e.g. "gruvbox". */
  name: string;
  dark?: PiTheme;
  light?: PiTheme;
}

export const BUILTIN_THEMES: BuiltinThemeSet[] = [
  { name: "gruvbox", dark: gruvboxDark as PiTheme, light: gruvboxLight as PiTheme },
  { name: "miku-aqua", dark: mikuAquaDark as PiTheme, light: mikuAquaLight as PiTheme },
  { name: "orbital-rose", dark: orbitalRoseDark as PiTheme, light: orbitalRoseLight as PiTheme },
  { name: "scarlet-tether", dark: scarletTetherDark as PiTheme, light: scarletTetherLight as PiTheme },
  { name: "solarized", dark: solarizedDark as PiTheme, light: solarizedLight as PiTheme },
];

/** Look up a built-in theme set by base name. */
export function findBuiltinTheme(name: string): BuiltinThemeSet | undefined {
  return BUILTIN_THEMES.find((t) => t.name === name);
}