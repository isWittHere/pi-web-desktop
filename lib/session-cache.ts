/**
 * LRU cache of recently opened session snapshots, keyed by session id.
 *
 * Lives on globalThis so it survives Next.js hot reloads (same pattern as
 * rpc-manager's __piSessions). A snapshot is only trusted while the session
 * file's mtime matches the mtime captured at load time — the caller proves
 * freshness via /api/sessions/[id]?meta=1 before reusing a snapshot and
 * falls back to a full load on any doubt, so this cache can never serve
 * stale content; it only skips work when the file is provably unchanged.
 */

interface CacheShape {
  context: { messages: unknown[]; entryIds: string[] };
}

export interface SessionCacheEntry<T = CacheShape> {
  data: T;
  /** File mtime (ISO string) captured when the snapshot was loaded. */
  infoModified: string;
}

const MAX_ENTRIES = 8;
const MAX_TOTAL_BYTES = 64 * 1024 * 1024; // 64 MB of message text

function getCacheMap(): Map<string, SessionCacheEntry<CacheShape>> {
  const g = globalThis as unknown as { __piSessionCache?: Map<string, SessionCacheEntry<CacheShape>> };
  if (!g.__piSessionCache) g.__piSessionCache = new Map();
  return g.__piSessionCache;
}

function estimateBytes(data: CacheShape): number {
  let bytes = 0;
  for (const raw of data.context.messages) {
    const content = (raw as { content?: unknown } | null)?.content;
    if (typeof content === "string") {
      bytes += content.length;
    } else if (Array.isArray(content)) {
      for (const block of content) {
        if (typeof block?.text === "string") bytes += block.text.length;
        else if (typeof block?.content === "string") bytes += block.content.length;
      }
    }
  }
  for (const id of data.context.entryIds) bytes += id.length;
  return bytes;
}

export function getCachedSession<T>(sessionId: string): SessionCacheEntry<T> | null {
  const cache = getCacheMap();
  const entry = cache.get(sessionId);
  if (!entry) return null;
  // LRU touch: move to the most-recent position.
  cache.delete(sessionId);
  cache.set(sessionId, entry);
  return entry as unknown as SessionCacheEntry<T>;
}

export function setCachedSession(sessionId: string, data: CacheShape, infoModified: string): void {
  // Never cache without a freshness anchor — a missing mtime would make the
  // snapshot permanently unusable.
  if (!infoModified) return;
  const cache = getCacheMap();
  cache.delete(sessionId);
  cache.set(sessionId, { data, infoModified });

  let total = 0;
  for (const entry of cache.values()) total += estimateBytes(entry.data);
  while ((cache.size > MAX_ENTRIES || total > MAX_TOTAL_BYTES) && cache.size > 1) {
    const oldestKey = cache.keys().next().value;
    if (oldestKey === undefined) break;
    const oldest = cache.get(oldestKey);
    if (oldest) total -= estimateBytes(oldest.data);
    cache.delete(oldestKey);
  }
}

export function clearSessionCache(): void {
  getCacheMap().clear();
}
