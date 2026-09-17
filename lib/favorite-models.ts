/**
 * Shared "favorite models" store.
 *
 * The chat model selector (ChatInput) and Settings → Models both read and
 * write the same localStorage key. They used to keep independent React state
 * seeded once on mount, so a favorite toggled in one place never reached the
 * other without a full reload — the `storage` DOM event does not fire in the
 * same document. This module is the single source of truth: a cached snapshot
 * plus a subscriber set consumed through useSyncExternalStore.
 *
 * Stored as a JSON array of `provider:modelId` keys; best-effort (a blocked
 * localStorage still applies the change for the current session).
 */

export const FAVORITE_MODELS_KEY = "pi-favorite-models";

interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

function getBrowserStorage(): StorageLike | null {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

/** `provider:modelId` — the key format shared by both consumers. */
export function favoriteModelKey(provider: string, modelId: string): string {
  return `${provider}:${modelId}`;
}

/** Parse a raw stored value; anything malformed yields an empty set. */
export function parseFavoriteModels(raw: string | null): Set<string> {
  if (!raw) return new Set();
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return new Set();
    return new Set(parsed.filter((value): value is string => typeof value === "string"));
  } catch {
    return new Set();
  }
}

const EMPTY_FAVORITES: Set<string> = new Set();

let cache: Set<string> | null = null;
const listeners = new Set<() => void>();
let storageBound = false;

function readStored(): Set<string> {
  const storage = getBrowserStorage();
  if (!storage) return new Set();
  try {
    return parseFavoriteModels(storage.getItem(FAVORITE_MODELS_KEY));
  } catch {
    // Storage blocked — treat as unset.
    return new Set();
  }
}

function notify(): void {
  for (const listener of listeners) listener();
}

function invalidate(): void {
  cache = null;
  notify();
}

function bindStorage(): void {
  if (storageBound || typeof window === "undefined") return;
  storageBound = true;
  // Cross-document sync (another window/tab). Same-document writes are
  // broadcast directly by the toggle functions below.
  window.addEventListener("storage", (event) => {
    if (event.key !== null && event.key !== FAVORITE_MODELS_KEY) return;
    invalidate();
  });
}

/** Current favorites snapshot; identity changes only when favorites change. */
export function getFavoriteModelsSnapshot(): Set<string> {
  if (cache === null) cache = readStored();
  return cache;
}

/** Stable empty snapshot for SSR/hydration. */
export function getFavoriteModelsServerSnapshot(): Set<string> {
  return EMPTY_FAVORITES;
}

export function subscribeFavoriteModels(listener: () => void): () => void {
  bindStorage();
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Toggle a `provider:modelId` key, persist it, and notify all subscribers. */
export function toggleFavoriteModelKey(key: string): void {
  const next = new Set(getFavoriteModelsSnapshot());
  if (next.has(key)) next.delete(key);
  else next.add(key);
  try {
    getBrowserStorage()?.setItem(FAVORITE_MODELS_KEY, JSON.stringify([...next]));
  } catch {
    // Storage unavailable — the change still applies for this session.
  }
  cache = next;
  notify();
}

export function toggleFavoriteModel(provider: string, modelId: string): void {
  toggleFavoriteModelKey(favoriteModelKey(provider, modelId));
}
