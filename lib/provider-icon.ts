/**
 * Provider icon mode resolution.
 *
 * Pure decision helpers (unit-testable, no DOM) plus a tiny
 * localStorage-backed per-provider setting store shared by ProviderIcon
 * and ModelsConfig. The store is a no-op on the server.
 */

export type ProviderIconMode = "auto" | "api" | "letter";

export const PROVIDER_ICON_MODES: readonly ProviderIconMode[] = ["auto", "api", "letter"];

export const PROVIDER_ICON_MODES_KEY = "pi-provider-icon-mode";

/**
 * API type → badge letter shown in the icon's bottom-right corner.
 * Letters are the API family's representative initial; duplicates across
 * families are fine because the main logo already disambiguates.
 */
export const API_TYPE_BADGES: Readonly<Record<string, string>> = {
  "openai-completions": "C",
  "openai-responses": "R",
  "openai-codex-responses": "X",
  "azure-openai-responses": "R",
  "anthropic-messages": "M",
  "google-generative-ai": "G",
  "google-vertex": "G",
  "mistral-conversations": "M",
  "bedrock-converse-stream": "B",
  "pi-messages": "P",
};

/** Badge letter for an API type, or null when the API type is unknown. */
export function resolveApiBadge(api: string | null | undefined): string | null {
  if (!api) return null;
  return API_TYPE_BADGES[api] ?? null;
}

/** First alphanumeric character of a provider id, uppercased; "?" when none. */
export function resolveProviderLetter(providerId: string): string {
  const match = providerId.trim().match(/[a-zA-Z0-9]/);
  return match ? match[0].toUpperCase() : "?";
}

/** Parse a stored mode value; anything invalid → "auto". */
export function parseProviderIconMode(raw: unknown): ProviderIconMode {
  return raw === "api" || raw === "letter" ? raw : "auto";
}

export type ProviderIconSource =
  | { type: "letter"; letter: string }
  | { type: "provider-logo" }
  | { type: "api-logo"; api: string; badge: string }
  | { type: "cpu" };

/**
 * Resolve which icon to render for a provider/model cell.
 * - letter: always the letter badge, no corner badge.
 * - api: the API-type representative logo + badge letter.
 * - auto: preset provider logo (plain, no badge) when available, else the
 *   API-type representative logo with badge letter, else CPU.
 */
export function resolveProviderIconSource(
  providerId: string,
  api: string | null | undefined,
  mode: ProviderIconMode,
  hasProviderLogo: boolean,
): ProviderIconSource {
  if (mode === "letter") return { type: "letter", letter: resolveProviderLetter(providerId) };
  const badge = resolveApiBadge(api);
  if (mode === "api") {
    if (badge && api) return { type: "api-logo", api, badge };
    // No API-type info (e.g. provider lists without a model context): keep
    // the preset logo rather than degrading every cell to a CPU icon.
    if (hasProviderLogo) return { type: "provider-logo" };
    return { type: "cpu" };
  }
  // Preset providers keep their plain logo — the badge is only a fallback
  // affordance for providers without a preset logo.
  if (hasProviderLogo) return { type: "provider-logo" };
  if (badge && api) return { type: "api-logo", api, badge };
  return { type: "cpu" };
}

// ── Per-provider mode store (client-only) ─────────────────────────────────────

function loadStoredModes(): Record<string, ProviderIconMode> {
  if (typeof window === "undefined") return {};
  try {
    const raw = window.localStorage.getItem(PROVIDER_ICON_MODES_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const modes: Record<string, ProviderIconMode> = {};
    for (const [providerId, value] of Object.entries(parsed)) {
      modes[providerId] = parseProviderIconMode(value);
    }
    return modes;
  } catch {
    // Unreadable or non-JSON value — treat as unset.
    return {};
  }
}

let modesCache: Record<string, ProviderIconMode> | null = null;
let modesVersion = 0;
const listeners = new Set<() => void>();

/** Current mode for a provider; "auto" when unset. */
export function getProviderIconMode(providerId: string): ProviderIconMode {
  if (modesCache === null) modesCache = loadStoredModes();
  return modesCache[providerId] ?? "auto";
}

/** Monotonic version bump used as a useSyncExternalStore snapshot. */
export function getProviderIconModesVersion(): number {
  return modesVersion;
}

export function subscribeProviderIconModes(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Persist a provider's icon mode and notify all subscribers. */
export function setProviderIconMode(providerId: string, mode: ProviderIconMode): void {
  const modes = loadStoredModes();
  if (mode === "auto") delete modes[providerId];
  else modes[providerId] = mode;
  try {
    window.localStorage.setItem(PROVIDER_ICON_MODES_KEY, JSON.stringify(modes));
  } catch {
    // Storage unavailable (private mode) — the change just won't persist.
  }
  modesCache = null;
  modesVersion++;
  for (const listener of listeners) listener();
}
