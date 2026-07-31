export interface ModelCatalogCost {
  input?: number;
  output?: number;
  cacheRead?: number;
  cacheWrite?: number;
}

export interface ModelCatalogEntry {
  providerId: string;
  providerName: string;
  providerBaseUrl?: string;
  id: string;
  name: string;
  reasoning?: boolean;
  input?: string[];
  contextWindow?: number;
  maxTokens?: number;
  cost: ModelCatalogCost;
}

export interface ModelCatalogPreset {
  name?: string;
  reasoning?: boolean;
  input?: string[];
  contextWindow?: number;
  maxTokens?: number;
  cost?: ModelCatalogCost;
}

export type ModelCatalogMatchMethod = "provider" | "base-url" | "consensus" | "none";

export interface ModelCatalogRecommendation {
  exactMatches: number;
  metadataMethod: ModelCatalogMatchMethod;
  matchedProviderName?: string;
  preset: ModelCatalogPreset;
  price: { reliable: boolean; method: ModelCatalogMatchMethod };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function string(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function positive(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : undefined;
}

function nonNegative(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : undefined;
}

function normalizeProvider(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]/g, "");
}

function normalizeModelId(value: string): string {
  return value.trim().toLowerCase().replace(/^models\//, "");
}

function hostname(value: string | undefined): string | undefined {
  if (!value) return undefined;
  try {
    return new URL(value).hostname.toLowerCase().replace(/\.$/, "");
  } catch {
    return undefined;
  }
}

function matchesHost(actual: string, expected: string): boolean {
  return actual === expected || actual.endsWith(`.${expected}`);
}

function exactMatch(entry: ModelCatalogEntry, modelId: string): boolean {
  const target = normalizeModelId(modelId);
  const id = normalizeModelId(entry.id);
  return Boolean(target) && (target === id || target === `${entry.providerId.toLowerCase()}/${id}`);
}

function matchesProvider(entry: ModelCatalogEntry, hint: string): boolean {
  const target = normalizeProvider(hint);
  return Boolean(target) && (normalizeProvider(entry.providerId) === target || normalizeProvider(entry.providerName) === target);
}

function matchesBaseUrl(entry: ModelCatalogEntry, baseUrl: string): boolean {
  const actual = hostname(baseUrl);
  const expected = hostname(entry.providerBaseUrl);
  return Boolean(actual && expected && matchesHost(actual, expected));
}

function hasUsablePrice(entry: ModelCatalogEntry): boolean {
  return entry.cost.input !== undefined && entry.cost.output !== undefined;
}

function presetFrom(entry: ModelCatalogEntry, includeCost: boolean): ModelCatalogPreset {
  return {
    name: entry.name,
    reasoning: entry.reasoning,
    input: entry.input,
    contextWindow: entry.contextWindow,
    maxTokens: entry.maxTokens,
    cost: includeCost ? entry.cost : undefined,
  };
}

/** Converts the fixed public models.dev response into the subset Pi Web needs. */
export function flattenModelsDevCatalog(value: unknown): ModelCatalogEntry[] {
  if (!isRecord(value)) return [];
  const entries: ModelCatalogEntry[] = [];
  for (const [providerId, rawProvider] of Object.entries(value)) {
    if (!isRecord(rawProvider) || !isRecord(rawProvider.models)) continue;
    const providerName = string(rawProvider.name) ?? providerId;
    const providerBaseUrl = string(rawProvider.api);
    for (const [fallbackId, rawModel] of Object.entries(rawProvider.models)) {
      if (!isRecord(rawModel)) continue;
      const id = string(rawModel.id) ?? fallbackId;
      if (!id) continue;
      const modalities = isRecord(rawModel.modalities) && Array.isArray(rawModel.modalities.input)
        ? Array.from(new Set(rawModel.modalities.input.filter((item): item is string => item === "text" || item === "image")))
        : undefined;
      const cost = isRecord(rawModel.cost) ? {
        input: nonNegative(rawModel.cost.input),
        output: nonNegative(rawModel.cost.output),
        cacheRead: nonNegative(rawModel.cost.cache_read),
        cacheWrite: nonNegative(rawModel.cost.cache_write),
      } : {};
      const limit = isRecord(rawModel.limit) ? rawModel.limit : {};
      entries.push({
        providerId,
        providerName,
        providerBaseUrl,
        id,
        name: string(rawModel.name) ?? id,
        reasoning: typeof rawModel.reasoning === "boolean" ? rawModel.reasoning : undefined,
        input: modalities?.length ? modalities : undefined,
        contextWindow: positive(limit.context),
        maxTokens: positive(limit.output),
        cost,
      });
    }
  }
  return entries;
}

/**
 * Prefer an exact Pi provider name, then an exact catalog base-URL host.
 * Without either, metadata can still be filled from a stable first entry, but
 * pricing is intentionally withheld because a provider may price the same ID
 * differently.
 */
export function recommendModelCatalogPreset(
  entries: readonly ModelCatalogEntry[],
  modelId: string,
  providerHint = "",
  baseUrl = "",
): ModelCatalogRecommendation {
  const exactMatches = entries.filter((entry) => exactMatch(entry, modelId));
  if (!exactMatches.length) {
    return { exactMatches: 0, metadataMethod: "none", preset: {}, price: { reliable: false, method: "none" } };
  }
  const providerMatch = exactMatches.find((entry) => matchesProvider(entry, providerHint));
  const baseUrlMatch = exactMatches.find((entry) => matchesBaseUrl(entry, baseUrl));
  const selected = providerMatch ?? baseUrlMatch ?? exactMatches[0];
  const method: ModelCatalogMatchMethod = providerMatch ? "provider" : baseUrlMatch ? "base-url" : "consensus";
  const reliablePrice = method !== "consensus" && hasUsablePrice(selected);
  return {
    exactMatches: exactMatches.length,
    metadataMethod: method,
    matchedProviderName: selected.providerName,
    preset: presetFrom(selected, reliablePrice),
    price: { reliable: reliablePrice, method: reliablePrice ? method : "none" },
  };
}
