/**
 * Shared session-list cache.
 *
 * Startup fires /api/sessions from multiple places at once (SessionSidebar's
 * initial load, AppShell's workspace restore, session hydration). Without a
 * shared cache that is one redundant network round-trip per cold start on a
 * list that can be hundreds of sessions. This module de-duplicates concurrent
 * callers onto a single in-flight promise and remembers the result until an
 * explicit refresh invalidates it.
 */

import type { SessionInfo } from "@/lib/types";

export interface SessionListData {
  sessions: SessionInfo[];
  runningSessionIds?: string[];
}

let cache: SessionListData | null = null;
let inFlight: Promise<SessionListData> | null = null;

/**
 * Return the session list, sharing the in-flight request across concurrent
 * callers and serving the cached result afterwards. Pass `force` to bypass
 * the cache (e.g. the sidebar's explicit refresh).
 */
export function getSessionList(force = false): Promise<SessionListData> {
  if (cache && !force) return Promise.resolve(cache);
  if (inFlight) return inFlight;
  // force bypasses the server-side session-list cache too, so an explicit
  // refresh also sees transient (not-yet-flushed) runtime sessions.
  inFlight = fetch(`/api/sessions${force ? "?force=1" : ""}`)
    .then(async (r) => {
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const d = (await r.json()) as SessionListData;
      cache = d;
      return d;
    })
    .finally(() => {
      inFlight = null;
    });
  return inFlight;
}

/** Drop the cached list so the next call re-fetches. */
export function invalidateSessionList(): void {
  cache = null;
}
