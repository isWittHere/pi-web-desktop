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
    const entry = readMap()[workspaceKey];
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
    map[workspaceKey] = entry;
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(map));
  } catch {
    // storage unavailable — memory is best-effort
  }
}

export function clearLastOpen(workspaceKey: string): void {
  try {
    const map = readMap();
    if (!(workspaceKey in map)) return;
    delete map[workspaceKey];
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
