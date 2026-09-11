export const MODEL_COST_KEYS = ["input", "output", "cacheRead", "cacheWrite"] as const;

export type ModelCostKey = (typeof MODEL_COST_KEYS)[number];

export type ModelCostRates = Record<ModelCostKey, number>;

export type ModelCostDraft = Record<ModelCostKey, string>;

export function modelCostToDraft(cost?: Partial<ModelCostRates>): ModelCostDraft {
  return {
    input: cost?.input === undefined ? "" : String(cost.input),
    output: cost?.output === undefined ? "" : String(cost.output),
    cacheRead: cost?.cacheRead === undefined ? "" : String(cost.cacheRead),
    cacheWrite: cost?.cacheWrite === undefined ? "" : String(cost.cacheWrite),
  };
}

/**
 * Parse a cost draft into a complete four-rate cost object.
 *
 * Blank fields count as 0, so a partially filled draft still saves a complete
 * cost group (the SDK's calculateCost reads all four rates; a partial group
 * would produce NaN in usage.cost.total). The whole draft is rejected when any
 * value is not a finite non-negative number, and an all-blank draft yields
 * undefined so the model keeps no cost group at all.
 */
export function parseCompleteModelCost(draft: ModelCostDraft): ModelCostRates | undefined {
  if (!hasModelCostDraftValue(draft)) return undefined;

  const parse = (value: string): number | undefined => {
    if (!value.trim()) return 0;
    const parsed = Number(value);
    return Number.isFinite(parsed) && parsed >= 0 ? parsed : undefined;
  };
  const input = parse(draft.input);
  const output = parse(draft.output);
  const cacheRead = parse(draft.cacheRead);
  const cacheWrite = parse(draft.cacheWrite);
  if (input === undefined || output === undefined || cacheRead === undefined || cacheWrite === undefined) {
    return undefined;
  }
  return { input, output, cacheRead, cacheWrite };
}

export function hasModelCostDraftValue(draft: ModelCostDraft): boolean {
  return MODEL_COST_KEYS.some((key) => draft[key].trim() !== "");
}

/**
 * Tri-state compat flag: an explicit `true`/`false`, or `undefined` meaning
 * "inherit" (fall through to the provider-level compat, then to pi's own
 * endpoint auto-detection).
 */
export type CompatFlag = boolean | undefined;

/** Read a boolean compat flag; non-boolean values from hand-edited JSON count as unset. */
export function readCompatFlag(compat: Record<string, unknown> | undefined, key: string): CompatFlag {
  const value = compat?.[key];
  return typeof value === "boolean" ? value : undefined;
}

/**
 * Write a compat flag while keeping the three states distinct.
 *
 * `undefined` drops the model-level override so the provider value (or pi's
 * default) applies again. An explicit boolean is always persisted: pi resolves
 * flags as `model.compat[key] ?? fallback`, so deleting the key would silently
 * turn a default-true flag (e.g. supportsDeveloperRole) back on. An emptied
 * compat map collapses to `undefined` so models.json keeps no `{}` noise.
 */
export function writeCompatFlag(
  compat: Record<string, unknown> | undefined,
  key: string,
  value: CompatFlag,
): Record<string, unknown> | undefined {
  const next = { ...(compat ?? {}) };
  if (value === undefined) delete next[key];
  else next[key] = value;
  return Object.keys(next).length ? next : undefined;
}

/** Where the effective value of a compat flag comes from. */
export type CompatOrigin = "model" | "provider" | "auto";

export interface ResolvedCompatFlag {
  origin: CompatOrigin;
  /** The effective value; absent only for `"auto"`, which pi resolves per request. */
  value?: boolean;
}

/**
 * Resolve the value pi will use, mirroring its composition order for
 * models.json providers: explicit model compat wins, then provider compat, then
 * pi's endpoint auto-detection. The UI cannot observe the auto-detected value,
 * so it reports `"auto"` rather than guessing.
 */
export function resolveCompatFlag(
  modelCompat: Record<string, unknown> | undefined,
  providerCompat: Record<string, unknown> | undefined,
  key: string,
): ResolvedCompatFlag {
  const modelValue = readCompatFlag(modelCompat, key);
  if (modelValue !== undefined) return { origin: "model", value: modelValue };
  const providerValue = readCompatFlag(providerCompat, key);
  if (providerValue !== undefined) return { origin: "provider", value: providerValue };
  return { origin: "auto" };
}
