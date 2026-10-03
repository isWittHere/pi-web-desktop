import type { SessionManager } from "@earendil-works/pi-coding-agent";
import { PRESET_FULL } from "./tool-presets";
import type { SessionEntry } from "./types";

/**
 * Custom entries that record the tool selection a user pinned onto a session,
 * so reload, tree navigation, and re-materialization restore it instead of the
 * SDK's transcript-derived loadout. A cleared entry retracts the pin so the
 * session follows settings.json defaultTools again.
 */
export const TOOL_SELECTION_TYPE = "pi-web:tool-selection";

export interface SessionToolSelectionData {
  toolNames: string[];
}

/** Data of the entry that records the user retracting a pinned selection. */
export interface ClearedSessionToolSelectionData {
  cleared: true;
}

const BUILTIN_TOOL_NAMES = new Set([...PRESET_FULL, "powershell"]);

/**
 * Validate a selection entry's payload into a concrete tool list, or undefined
 * when the payload is not a usable selection (wrong shape or unknown names).
 */
export function validateSessionToolSelection(data: unknown): string[] | undefined {
  if (typeof data !== "object" || data === null) return undefined;
  const toolNames = (data as SessionToolSelectionData).toolNames;
  if (
    !Array.isArray(toolNames)
    || !toolNames.every((name) => typeof name === "string" && BUILTIN_TOOL_NAMES.has(name))
  ) {
    return undefined;
  }
  return [...toolNames];
}

/**
 * The latest pinned selection on the given (active-branch) entries, in leaf
 * order. A cleared entry retracts the pin, invalid entries are skipped, and a
 * file without any selection entry returns undefined.
 */
export function readSessionToolSelection(
  entries: readonly SessionEntry[],
): string[] | undefined {
  for (let i = entries.length - 1; i >= 0; i--) {
    const entry = entries[i];
    if (entry.type !== "custom" || entry.customType !== TOOL_SELECTION_TYPE) continue;
    const data: unknown = entry.data;
    if (
      typeof data === "object" && data !== null
      && (data as ClearedSessionToolSelectionData).cleared === true
    ) {
      return undefined;
    }
    const selection = validateSessionToolSelection(data);
    if (selection !== undefined) return selection;
  }
  return undefined;
}

/** Record the pinned selection on the session's current leaf. */
export function appendSessionToolSelection(
  sessionManager: SessionManager,
  toolNames: readonly string[],
): void {
  sessionManager.appendCustomEntry(TOOL_SELECTION_TYPE, {
    toolNames: [...toolNames],
  } satisfies SessionToolSelectionData);
}

/** Record that the pinned selection was retracted (the session follows settings). */
export function appendClearedSessionToolSelection(
  sessionManager: SessionManager,
): void {
  sessionManager.appendCustomEntry(TOOL_SELECTION_TYPE, {
    cleared: true,
  } satisfies ClearedSessionToolSelectionData);
}
