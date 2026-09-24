export interface ToolEntry {
  name: string;
  description: string;
  active: boolean;
  /** JSON-schema (TypeBox) parameter schema. Omitted for tools without parameters. */
  parameters?: unknown;
  /** Guideline bullets appended to the default system prompt when this tool is active. */
  promptGuidelines?: string[];
}

/** Presets that pin an explicit tool list onto the session. */
export type ConcreteToolPreset = "none" | "read-only" | "default" | "full";

/**
 * "configured" is not a tool list: it means "send no override", so pi resolves the
 * loadout from settings.json defaultTools exactly like the `pi` CLI does. Sessions
 * left on it stay unpinned and keep following the setting as it changes (#700).
 */
export const CONFIGURED_TOOL_PRESET = "configured";
export const ALL_TOOL_PRESET_VALUES = ["configured", "none", "read-only", "default", "full"] as const;
export type AllToolPreset = typeof ALL_TOOL_PRESET_VALUES[number];

export function isAllToolPreset(value: unknown): value is AllToolPreset {
  return typeof value === "string" && (ALL_TOOL_PRESET_VALUES as readonly string[]).includes(value);
}

export const PRESET_NONE: string[] = [];
export const PRESET_READ_ONLY: string[] = ["read", "grep", "find", "ls"];
export const PRESET_DEFAULT: string[] = ["read", "bash", "edit", "write"];
export const PRESET_FULL: string[] = ["bash", "read", "edit", "write", "grep", "find", "ls"];

const BUILTIN_TOOL_NAMES = new Set([...PRESET_FULL, "powershell"]);

/**
 * A preset inferred from a live active-tool set. "custom" means the builtin
 * active set matches no preset combination (e.g. a user-tailored settings.json
 * defaultTools) — it is an honest result, never a fallback masquerade.
 */
export type InferredToolPreset = ConcreteToolPreset | "custom";

/**
 * Infer the preset from a live active-tool set. Returns "custom" when the
 * builtin active set matches no preset combination instead of silently
 * masquerading as "default". Extension tools and the powershell↔bash shell
 * mapping are ignored.
 */
export function deriveToolPresetFromActive(
  activeNames: readonly string[],
): InferredToolPreset {
  const active = [...new Set(
    activeNames
      .map((name) => name === "powershell" ? "bash" : name)
      .filter((name) => BUILTIN_TOOL_NAMES.has(name)),
  )].sort().join(",");

  if (active === "") return "none";
  if (active === [...PRESET_READ_ONLY].sort().join(",")) return "read-only";
  if (active === [...PRESET_DEFAULT].sort().join(",")) return "default";
  if (active === [...PRESET_FULL].sort().join(",")) return "full";
  return "custom";
}

export function getToolNamesForPreset(preset: ConcreteToolPreset): string[] {
  if (preset === "none") return [...PRESET_NONE];
  if (preset === "read-only") return [...PRESET_READ_ONLY];
  if (preset === "full") return [...PRESET_FULL];
  return [...PRESET_DEFAULT];
}

/** Undefined means "no explicit selection": let pi resolve settings.json defaultTools. */
export function getAllToolNamesForPreset(preset: AllToolPreset): string[] | undefined {
  if (preset === CONFIGURED_TOOL_PRESET) return undefined;
  return getToolNamesForPreset(preset);
}

/**
 * Infer the builtin tool preset from a session's live tool state and return
 * its coding tool names. The SDK activates every extension tool at session
 * construction (`includeAllExtensionTools`), so a session's active set may
 * carry extra host tools (e.g. Windows `powershell`) on top of the real
 * preset; `deriveToolPresetFromActive` maps powershell → bash and only counts
 * builtin names, which neutralizes that bloat. Non-coding extension tools are
 * ignored here — callers re-append them separately. Returns [] for "none".
 */
export function deriveToolNamesFromActive(
  activeNames: readonly string[],
): string[] {
  const inferred = deriveToolPresetFromActive(activeNames);
  return getToolNamesForPreset(inferred === "custom" ? "default" : inferred);
}
