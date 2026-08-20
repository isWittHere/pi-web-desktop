import { foldWindowsKey, isWindowsPlatform, normalizePathKey } from "./path-match";

/**
 * Per-workspace "last open context" memory.
 *
 * Switching to a workspace (project root or cwd) restores whatever the user
 * had open there last: a real session or a draft. Without this, every
 * workspace switch landed on a blank new-session page and the previously open
 * session had to be re-picked manually.
 *
 * The workspace key is the resolved project root when known (sessions get it
 * from the server, drafts from the sidebar's worktree resolution) so all
 * worktrees of one repo share a single memory slot. Falls back to the raw cwd
 * for non-repo directories, which is also its own project key there.
 *
 * Stored in localStorage; best-effort (silently ignored if unavailable).
 */

export type LastOpenEntry = { kind: "session" | "draft"; id: string };

const STORAGE_KEY = "pi-web:last-open-by-workspace";

/**
 * "Last active workspace" memory.
 *
 * getRecentProjects() only knows which workspace has the most recently
 * *modified* session — that is not the workspace the user last worked in
 * (merely opening a session, or a newer background run elsewhere, drifts the
 * ordering). The app therefore persisted nothing about which workspace was
 * active at close, so every restart landed on the newest-session project
 * instead of the one actually left open. This separate key records the active
 * workspace on every switch so startup can return to it.
 */
const LAST_WORKSPACE_KEY = "pi-web:last-workspace";

/** The workspace that was active when the app last closed, or null. */
export function getLastWorkspace(): string | null {
  try {
    const key = window.localStorage.getItem(LAST_WORKSPACE_KEY);
    return key && key.length > 0 ? key : null;
  } catch {
    return null;
  }
}

/** Persist the currently active workspace (project root when known, else cwd). */
export function setLastWorkspace(workspaceKey: string): void {
  try {
    window.localStorage.setItem(LAST_WORKSPACE_KEY, workspaceKey);
  } catch {
    // storage unavailable — memory is best-effort
  }
}

/** Forget the last active workspace (e.g. the user closed every workspace
 *  tab): the next startup auto-select must not jump back to it. */
export function clearLastWorkspace(): void {
  try {
    window.localStorage.removeItem(LAST_WORKSPACE_KEY);
  } catch {
    // storage unavailable — memory is best-effort
  }
}

// ── Welcome-state flag ─────────────────────────────────────────────────────
// Clearing the last workspace alone is not enough: the startup auto-select
// falls back to the most recently modified project, so a restart would still
// land in a workspace. The flag arms when every workspace tab is closed and
// is consumed by the auto-select (stay on the welcome page) until the user
// picks a workspace again.

const WELCOME_STATE_KEY = "pi-web:welcome-state";

/** Arm the welcome state: the next startup stays on the welcome page. */
export function setWelcomeState(): void {
  try {
    window.localStorage.setItem(WELCOME_STATE_KEY, "1");
  } catch {
    // storage unavailable — memory is best-effort
  }
}

/** True while the welcome state is armed (every workspace was closed). */
export function getWelcomeState(): boolean {
  try {
    return window.localStorage.getItem(WELCOME_STATE_KEY) === "1";
  } catch {
    return false;
  }
}

/** Disarm the welcome state once the user picks a workspace again. */
export function clearWelcomeState(): void {
  try {
    window.localStorage.removeItem(WELCOME_STATE_KEY);
  } catch {
    // storage unavailable — memory is best-effort
  }
}

function readMap(): Record<string, LastOpenEntry | undefined> {
  const raw = window.localStorage.getItem(STORAGE_KEY);
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw) as Record<string, LastOpenEntry | undefined>;
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

/** The remembered context for a workspace, or null when none/stale. */
export function getLastOpen(workspaceKey: string): LastOpenEntry | null {
  try {
    const map = readMap();
    // Stored keys are normalized (forward slashes, uppercase drive letter),
    // while callers pass raw forms (pi session records use backslashes,
    // lobby entries come from external detectors) — look up the canonical
    // key first, then fall back to a folding scan.
    let entry = map[workspaceKey] ?? map[normalizePathKey(workspaceKey)];
    if (!entry && isWindowsPlatform()) {
      // Keys may have been written with a differently-cased drive letter or
      // separator style (lobby entries normalize to forward slashes, pi
      // session records use backslashes, older records may vary). Multiple
      // folded-equivalent keys can exist in legacy stores (each spelling
      // written under its own key) — resolve to the MOST RECENTLY written
      // one (last insertion), never the first: the first is a stale duplicate
      // whose value stops being updated once writes move to another spelling,
      // which would pin the remembered session forever.
      const folded = foldWindowsKey(workspaceKey);
      const keys = Object.keys(map);
      for (let i = keys.length - 1; i >= 0; i--) {
        if (foldWindowsKey(keys[i]) === folded) {
          entry = map[keys[i]];
          break;
        }
      }
    }
    if (!entry) return null;
    if (entry.kind !== "session" && entry.kind !== "draft") return null;
    if (typeof entry.id !== "string" || entry.id.length === 0) return null;
    return entry;
  } catch {
    return null;
  }
}

export function setLastOpen(workspaceKey: string, entry: LastOpenEntry): void {
  try {
    const map = readMap();
    const key = normalizePathKey(workspaceKey);
    // Collapse folded-equivalent duplicates (older records may have been
    // written under another spelling — lobby forward slashes, pi-native
    // backslashes, external case variants) so one workspace keeps exactly
    // one slot and reads can never resolve to a stale copy.
    if (isWindowsPlatform()) {
      const folded = foldWindowsKey(key);
      for (const k of Object.keys(map)) {
        if (k !== key && foldWindowsKey(k) === folded) delete map[k];
      }
    }
    map[key] = entry;
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(map));
  } catch {
    // storage unavailable — memory is best-effort
  }
}

export function clearLastOpen(workspaceKey: string): void {
  try {
    const map = readMap();
    const key = normalizePathKey(workspaceKey);
    if (!(key in map)) {
      // Tolerate a differently-cased/styled stored key.
      if (!isWindowsPlatform()) return;
      const folded = foldWindowsKey(key);
      const found = Object.keys(map).find((k) => foldWindowsKey(k) === folded);
      if (!found) return;
      delete map[found];
    } else {
      delete map[key];
    }
    // Keep the store clean: drop the key entirely when nothing is remembered.
    if (Object.keys(map).length === 0) window.localStorage.removeItem(STORAGE_KEY);
    else window.localStorage.setItem(STORAGE_KEY, JSON.stringify(map));
  } catch {
    // ignore
  }
}

/** Workspace identity for a session: resolved project root when known, else cwd. */
export function workspaceKeyOf(session: { cwd: string; projectRoot?: string | null }): string {
  return session.projectRoot ?? session.cwd;
}
