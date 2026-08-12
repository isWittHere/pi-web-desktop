import { copyFileSync, existsSync, mkdirSync, readFileSync } from "fs";
import { dirname, join } from "path";
import { getAgentDir } from "@earendil-works/pi-coding-agent";
import { writePrivateFileAtomicSync } from "./atomic-file";
import { invalidateModelsCache } from "./models-cache";

const MODEL_COST_KEYS = ["input", "output", "cacheRead", "cacheWrite"] as const;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Complete a partial cost group with zeros, or drop it entirely when empty.
 *
 * The SDK's calculateCost reads all four rates directly; a partial group
 * (e.g. { input: 1 } without cacheRead/cacheWrite) leaves the missing rates
 * undefined and produces NaN in usage.cost.total. Only a group with no
 * values at all is omitted, so an explicitly blank model keeps no cost.
 */
function normalizeModelCost(value: unknown): Record<string, unknown> | undefined {
  if (!isRecord(value)) return undefined;
  const providedKeys = MODEL_COST_KEYS.filter((key) => value[key] !== undefined);
  if (providedKeys.length === 0) return undefined;
  if (providedKeys.some((key) => (
    typeof value[key] !== "number" || !Number.isFinite(value[key])
  ))) return undefined;

  return Object.fromEntries([
    ...Object.entries(value),
    ...MODEL_COST_KEYS.map((key) => [key, value[key] ?? 0]),
  ]);
}

/** Normalize cost groups across every model entry without mutating the input. */
export function normalizeModelsConfigCosts(
  data: Record<string, unknown>,
): Record<string, unknown> {
  const normalized = structuredClone(data);
  if (!isRecord(normalized.providers)) return normalized;

  for (const provider of Object.values(normalized.providers)) {
    if (!isRecord(provider) || !Array.isArray(provider.models)) continue;
    for (const model of provider.models) {
      if (!isRecord(model) || !("cost" in model)) continue;
      const cost = normalizeModelCost(model.cost);
      if (cost) model.cost = cost;
      else delete model.cost;
    }
  }
  return normalized;
}

/** Drop model rows whose id is blank, so an accidental empty row is not saved. */
function sanitizeModelsConfig(data: Record<string, unknown>): Record<string, unknown> {
  if (!isRecord(data.providers)) return data;

  const providers = Object.fromEntries(Object.entries(data.providers).map(([providerId, provider]) => {
    if (!isRecord(provider) || !Array.isArray(provider.models)) return [providerId, provider];
    const models = provider.models.filter((model) => (
      !isRecord(model) || typeof model.id !== "string" || model.id.trim().length > 0
    ));
    return [providerId, { ...provider, models }];
  }));

  return { ...data, providers };
}

/** Count models with a non-blank id across all providers. */
function countRealModels(data: Record<string, unknown>): number {
  if (!isRecord(data.providers)) return 0;
  let count = 0;
  for (const provider of Object.values(data.providers)) {
    if (!isRecord(provider) || !Array.isArray(provider.models)) continue;
    for (const model of provider.models) {
      if (isRecord(model) && typeof model.id === "string" && model.id.trim().length > 0) {
        count += 1;
      }
    }
  }
  return count;
}

/**
 * Guard against a near-empty save clobbering a real configuration.
 *
 * The settings UI sends the whole models.json it loaded, so a save performed
 * from an incomplete load (or a stray blank provider row) can silently wipe
 * every configured model. Refuse a write that would replace real models with
 * none, and keep a backup of the previous file either way.
 */
export class ModelsConfigWriteError extends Error {
  readonly existingModelCount: number;
  readonly incomingModelCount: number;

  constructor(existingModelCount: number, incomingModelCount: number) {
    super(
      `Refusing to overwrite ${existingModelCount} configured model${existingModelCount === 1 ? "" : "s"} `
      + `with an empty configuration (${incomingModelCount} model${incomingModelCount === 1 ? "" : "s"}). `
      + "Your models.json was preserved.",
    );
    this.existingModelCount = existingModelCount;
    this.incomingModelCount = incomingModelCount;
    this.name = "ModelsConfigWriteError";
  }
}

export function getModelsConfigBackupPath(modelsPath = getModelsConfigPath()): string {
  return `${modelsPath}.bak`;
}

/** Copy the current file aside before an overwrite; a no-op when absent/identical. */
function backupModelsConfig(modelsPath: string, nextContent: string): void {
  if (!existsSync(modelsPath)) return;
  try {
    if (readFileSync(modelsPath, "utf8") === nextContent) return;
    copyFileSync(modelsPath, getModelsConfigBackupPath(modelsPath));
  } catch {
    // Backup is best-effort; never block a write on it.
  }
}


export function getModelsConfigPath(): string {
  return join(getAgentDir(), "models.json");
}

export function readModelsConfig(
  modelsPath = getModelsConfigPath(),
): Record<string, unknown> {
  if (!existsSync(modelsPath)) return { providers: {} };
  try {
    return JSON.parse(readFileSync(modelsPath, "utf8")) as Record<string, unknown>;
  } catch {
    return { providers: {} };
  }
}

export function writeModelsConfig(
  data: Record<string, unknown>,
  modelsPath = getModelsConfigPath(),
): void {
  const dir = dirname(modelsPath);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  const normalized = normalizeModelsConfigCosts(sanitizeModelsConfig(data));
  const nextContent = JSON.stringify(normalized, null, 2);

  // Never let an empty save silently wipe a real configuration.
  const existing = readModelsConfig(modelsPath);
  const existingModels = countRealModels(existing);
  const incomingModels = countRealModels(normalized);
  if (existingModels > 0 && incomingModels === 0) {
    throw new ModelsConfigWriteError(existingModels, incomingModels);
  }

  backupModelsConfig(modelsPath, nextContent);
  writePrivateFileAtomicSync(modelsPath, nextContent);
  invalidateModelsCache();
}
