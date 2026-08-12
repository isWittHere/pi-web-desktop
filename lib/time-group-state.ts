import type { TimeBucket } from "./types";

/**
 * Persisted collapsed state of the session-list time-group headers.
 *
 * "earlier" is collapsed by default and its rows are not rendered until the
 * user expands the group (render-level lazy loading); all other groups start
 * expanded. Stored in localStorage so the user's grouping habits survive
 * reloads — same pattern as draft-store / file-explorer-state.
 */

const STORAGE_KEY = "pi-collapsed-time-groups";

export type CollapsedTimeGroups = Record<TimeBucket, boolean>;

const DEFAULTS: CollapsedTimeGroups = {
  pinned: false,
  today: false,
  yesterday: false,
  week: false,
  month: false,
  earlier: true,
};

export function loadCollapsedTimeGroups(): CollapsedTimeGroups {
  if (typeof window === "undefined") return { ...DEFAULTS };
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return { ...DEFAULTS };
    const parsed = JSON.parse(raw) as Partial<Record<TimeBucket, boolean>>;
    const result = { ...DEFAULTS };
    for (const bucket of Object.keys(DEFAULTS) as TimeBucket[]) {
      if (typeof parsed[bucket] === "boolean") result[bucket] = parsed[bucket];
    }
    return result;
  } catch {
    return { ...DEFAULTS };
  }
}

export function saveCollapsedTimeGroups(groups: CollapsedTimeGroups): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(groups));
  } catch {
    // Ignore quota/security errors — collapse state is a nicety, not critical.
  }
}
